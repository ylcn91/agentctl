import { test, expect, describe } from "bun:test";
import {
  toMCPError,
  formatMCPErrorResponse,
  wrapMCPHandler,
  type MCPToolError,
} from "../src/mcp/errors";
import {
  AuthError,
  TimeoutError,
  ContextOverflowError,
  APIError,
} from "../src/services/errors";

describe("toMCPError", () => {
  test("classifies auth error as AUTH_FAILED", () => {
    const result = toMCPError(new AuthError("bad token"), "send_message");
    expect(result.code).toBe("AUTH_FAILED");
    expect(result.retryable).toBe(false);
    expect(result.tool).toBe("send_message");
  });

  test("classifies timeout as TIMEOUT", () => {
    const result = toMCPError(new TimeoutError(5000));
    expect(result.code).toBe("TIMEOUT");
    expect(result.retryable).toBe(true);
  });

  test("classifies rate limit as RATE_LIMITED", () => {
    const result = toMCPError(new APIError("too many", { statusCode: 429 }));
    expect(result.code).toBe("RATE_LIMITED");
    expect(result.retryable).toBe(true);
  });

  test("classifies context overflow as OVERFLOW", () => {
    const result = toMCPError(new ContextOverflowError("too long"));
    expect(result.code).toBe("OVERFLOW");
    expect(result.retryable).toBe(false);
  });

  test("classifies 'not found' messages as NOT_FOUND", () => {
    const result = toMCPError(new Error("Account not found: alice"));
    expect(result.code).toBe("NOT_FOUND");
  });

  test("classifies 'does not exist' messages as NOT_FOUND", () => {
    const result = toMCPError(new Error("Task does not exist"));
    expect(result.code).toBe("NOT_FOUND");
  });

  test("classifies validation errors as VALIDATION", () => {
    const result = toMCPError(new Error("Invalid task status transition"));
    expect(result.code).toBe("VALIDATION");
  });

  test("classifies 'required' messages as VALIDATION", () => {
    const result = toMCPError(new Error("Field 'title' is required"));
    expect(result.code).toBe("VALIDATION");
  });

  test("classifies overloaded (529) as RATE_LIMITED", () => {
    const result = toMCPError(new APIError("overloaded", { statusCode: 529 }));
    expect(result.code).toBe("RATE_LIMITED");
    expect(result.retryable).toBe(true);
  });

  test("classifies unknown errors as INTERNAL", () => {
    const result = toMCPError(new Error("something went wrong"));
    expect(result.code).toBe("INTERNAL");
    expect(result.retryable).toBe(false);
  });

  test("classifies non-Error values", () => {
    const result = toMCPError("string error");
    expect(result.code).toBe("INTERNAL");
  });
});

describe("formatMCPErrorResponse", () => {
  test("returns isError: true with JSON content", () => {
    const error: MCPToolError = {
      code: "AUTH_FAILED",
      message: "bad token",
      retryable: false,
      tool: "send_message",
    };
    const response = formatMCPErrorResponse(error);
    expect(response.isError).toBe(true);
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe("text");

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error).toBe("AUTH_FAILED");
    expect(parsed.message).toBe("bad token");
    expect(parsed.retryable).toBe(false);
    expect(parsed.tool).toBe("send_message");
  });

  test("omits tool when not provided", () => {
    const error: MCPToolError = {
      code: "TIMEOUT",
      message: "timed out",
      retryable: true,
    };
    const response = formatMCPErrorResponse(error);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.tool).toBeUndefined();
  });
});

describe("wrapMCPHandler", () => {
  test("passes through successful results", async () => {
    const handler = wrapMCPHandler("my_tool", async (args: { x: number }) => {
      return { content: [{ type: "text" as const, text: String(args.x) }] };
    });
    const result = await handler({ x: 42 });
    expect(result).toEqual({ content: [{ type: "text", text: "42" }] });
  });

  test("catches errors and returns structured MCP error", async () => {
    const handler = wrapMCPHandler("my_tool", async () => {
      throw new AuthError("invalid credentials");
    });
    const result = (await handler({})) as any;
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("AUTH_FAILED");
    expect(parsed.retryable).toBe(false);
    expect(parsed.tool).toBe("my_tool");
  });

  test("handles timeout errors as retryable", async () => {
    const handler = wrapMCPHandler("search", async () => {
      throw new TimeoutError(5000);
    });
    const result = (await handler({})) as any;
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("TIMEOUT");
    expect(parsed.retryable).toBe(true);
  });

  test("handles generic errors", async () => {
    const handler = wrapMCPHandler("read_messages", async () => {
      throw new Error("Account not found: bob");
    });
    const result = (await handler({})) as any;
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("NOT_FOUND");
  });
});
