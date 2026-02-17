import { test, expect, describe } from "bun:test";
import {
  AgentctlError,
  APIError,
  ContextOverflowError,
  AuthError,
  ToolError,
  TimeoutError,
  AbortError,
  classifyError,
  retryDelay,
  formatErrorForUI,
  withRetry,
} from "../src/services/errors";

describe("AgentctlError base class", () => {
  test("stores category and retryable flag", () => {
    const err = new AgentctlError("test", { category: "network", retryable: true });
    expect(err.message).toBe("test");
    expect(err.category).toBe("network");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("AgentctlError");
  });

  test("defaults retryable to false", () => {
    const err = new AgentctlError("test", { category: "unknown" });
    expect(err.retryable).toBe(false);
  });
});

describe("APIError", () => {
  test("classifies 429 as rate_limit and retryable", () => {
    const err = new APIError("too many", { statusCode: 429 });
    expect(err.category).toBe("rate_limit");
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
    expect(err.name).toBe("APIError");
  });

  test("classifies 401 as auth and non-retryable", () => {
    const err = new APIError("unauthorized", { statusCode: 401 });
    expect(err.category).toBe("auth");
    expect(err.retryable).toBe(false);
  });

  test("classifies 529 as overloaded and retryable", () => {
    const err = new APIError("overloaded", { statusCode: 529 });
    expect(err.category).toBe("overloaded");
    expect(err.retryable).toBe(true);
  });

  test("classifies 500 as network and retryable", () => {
    const err = new APIError("server error", { statusCode: 500 });
    expect(err.category).toBe("network");
    expect(err.retryable).toBe(true);
  });

  test("parses retry-after-ms header", () => {
    const err = new APIError("rate limited", {
      statusCode: 429,
      responseHeaders: { "retry-after-ms": "3500" },
    });
    expect(err.retryAfterMs).toBe(3500);
  });

  test("parses retry-after header in seconds", () => {
    const err = new APIError("rate limited", {
      statusCode: 429,
      responseHeaders: { "retry-after": "5" },
    });
    expect(err.retryAfterMs).toBe(5000);
  });
});

describe("Specific error types", () => {
  test("ContextOverflowError is non-retryable", () => {
    const err = new ContextOverflowError();
    expect(err.category).toBe("context_overflow");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("ContextOverflowError");
  });

  test("AuthError is non-retryable", () => {
    const err = new AuthError("bad token");
    expect(err.category).toBe("auth");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("AuthError");
  });

  test("ToolError captures tool name", () => {
    const err = new ToolError("Read", "file not found");
    expect(err.toolName).toBe("Read");
    expect(err.category).toBe("tool_error");
    expect(err.name).toBe("ToolError");
  });

  test("TimeoutError captures timeout duration", () => {
    const err = new TimeoutError(30000);
    expect(err.timeoutMs).toBe(30000);
    expect(err.category).toBe("timeout");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("TimeoutError");
  });

  test("AbortError is non-retryable", () => {
    const err = new AbortError();
    expect(err.category).toBe("abort");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("AbortError");
  });
});

describe("classifyError", () => {
  test("passes through AgentctlError unchanged", () => {
    const original = new APIError("test", { statusCode: 429 });
    expect(classifyError(original)).toBe(original);
  });

  test("classifies DOMException AbortError", () => {
    const err = classifyError(new DOMException("aborted", "AbortError"));
    expect(err).toBeInstanceOf(AbortError);
  });

  test("classifies context overflow from opencode-style patterns", () => {
    const overflowMessages = [
      "prompt is too long",
      "Input is too long for requested model",
      "This request exceeds the context window",
      "maximum context length is 200000 tokens",
      "context_length_exceeded",
      "context length exceeded",
      "exceeded model token limit",
      "reduce the length of the messages",
      "exceeds the available context size",
      "greater than the context length",
      "context window exceeds limit",
      "input token count 150000 exceeds the maximum of 128000",
      "maximum prompt length is 100000",
      "exceeds the limit of 128000",
    ];
    for (const msg of overflowMessages) {
      const err = classifyError(new Error(msg));
      expect(err).toBeInstanceOf(ContextOverflowError);
      expect(err.retryable).toBe(false);
    }
  });

  test("classifies 401 from message", () => {
    const err = classifyError(new Error("HTTP 401 unauthorized"));
    expect(err).toBeInstanceOf(AuthError);
  });

  test("classifies 429 from message", () => {
    const err = classifyError(new Error("429 rate limit exceeded"));
    expect(err).toBeInstanceOf(APIError);
    expect(err.category).toBe("rate_limit");
  });

  test("classifies overloaded from message", () => {
    const err = classifyError(new Error("API overloaded please retry"));
    expect(err).toBeInstanceOf(APIError);
    expect(err.retryable).toBe(true);
  });

  test("classifies timeout from message", () => {
    const err = classifyError(new Error("request timed out"));
    expect(err).toBeInstanceOf(TimeoutError);
  });

  test("classifies network errors from message", () => {
    const err = classifyError(new Error("ECONNREFUSED"));
    expect(err.category).toBe("network");
    expect(err.retryable).toBe(true);
  });

  test("classifies unknown errors", () => {
    const err = classifyError(new Error("something weird happened"));
    expect(err.category).toBe("unknown");
    expect(err.retryable).toBe(false);
  });

  test("handles non-Error values", () => {
    const err = classifyError("string error");
    expect(err).toBeInstanceOf(AgentctlError);
    expect(err.message).toBe("string error");
  });
});

describe("retryDelay", () => {
  test("uses exponential backoff", () => {
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(2)).toBe(4000);
    expect(retryDelay(3)).toBe(8000);
  });

  test("caps at max delay", () => {
    expect(retryDelay(10)).toBe(30000);
  });

  test("uses retryAfterMs from error when available", () => {
    const err = new APIError("rate limited", {
      statusCode: 429,
      retryAfterMs: 5000,
    });
    expect(retryDelay(1, err)).toBe(5000);
  });
});

describe("formatErrorForUI", () => {
  test("formats rate limit error", () => {
    const err = new APIError("too many requests", { statusCode: 429 });
    expect(formatErrorForUI(err, 4000)).toBe("Rate limited -- retrying in 4s");
  });

  test("formats auth error", () => {
    const err = new AuthError();
    expect(formatErrorForUI(err)).toBe("Authentication failed -- check credentials");
  });

  test("formats context overflow", () => {
    const err = new ContextOverflowError();
    expect(formatErrorForUI(err)).toBe("Context window exceeded -- conversation too long");
  });

  test("formats timeout", () => {
    const err = new TimeoutError(30000);
    expect(formatErrorForUI(err)).toBe("Request timed out -- retrying");
  });

  test("formats tool error with message", () => {
    const err = new ToolError("Read", "permission denied");
    expect(formatErrorForUI(err)).toBe("Tool error: permission denied");
  });

  test("formats abort", () => {
    const err = new AbortError();
    expect(formatErrorForUI(err)).toBe("Aborted");
  });

  test("formats overloaded with retry time", () => {
    const err = new APIError("overloaded", { statusCode: 529 });
    expect(formatErrorForUI(err, 3000)).toBe("Provider overloaded -- retrying in 3s");
  });

  test("formats network error", () => {
    const err = new AgentctlError("ECONNREFUSED", { category: "network", retryable: true });
    expect(formatErrorForUI(err)).toBe("Network error -- check connection");
  });
});

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const result = await withRetry(async () => "ok");
    expect(result).toBe("ok");
  });

  test("retries retryable errors and recovers", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 2) throw new APIError("retry me", { statusCode: 429, retryAfterMs: 1 });
      return "recovered";
    }, { maxAttempts: 3 });
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });

  test("throws after max attempts exhausted", async () => {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls++;
        throw new APIError("retry me", { statusCode: 429, retryAfterMs: 1 });
      }, { maxAttempts: 2 });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.category).toBe("rate_limit");
      expect(calls).toBe(2);
    }
  });

  test("does not retry non-retryable errors", async () => {
    let calls = 0;
    try {
      await withRetry(async () => {
        calls++;
        throw new AuthError("bad token");
      }, { maxAttempts: 3 });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.category).toBe("auth");
      expect(calls).toBe(1);
    }
  });

  test("calls onRetry callback", async () => {
    const retries: Array<{ attempt: number; delayMs: number }> = [];
    let calls = 0;
    await withRetry(async () => {
      calls++;
      if (calls < 3) throw new APIError("retry me", { statusCode: 429, retryAfterMs: 1 });
      return "ok";
    }, {
      maxAttempts: 3,
      onRetry: (_err, attempt, delayMs) => {
        retries.push({ attempt, delayMs });
      },
    });
    expect(retries).toHaveLength(2);
    expect(retries[0].attempt).toBe(1);
    expect(retries[1].attempt).toBe(2);
  });

  test("respects pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await withRetry(async () => "ok", { signal: controller.signal });
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.category).toBe("abort");
    }
  });
});
