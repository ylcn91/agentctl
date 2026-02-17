
export type ErrorCategory =
  | "rate_limit"
  | "auth"
  | "context_overflow"
  | "timeout"
  | "tool_error"
  | "network"
  | "abort"
  | "overloaded"
  | "unknown";

export class AgentctlError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    opts: {
      category: ErrorCategory;
      retryable?: boolean;
      statusCode?: number;
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = "AgentctlError";
    this.category = opts.category;
    this.retryable = opts.retryable ?? false;
    this.statusCode = opts.statusCode;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export class APIError extends AgentctlError {
  constructor(
    message: string,
    opts: {
      statusCode: number;
      retryable?: boolean;
      retryAfterMs?: number;
      responseHeaders?: Record<string, string>;
      cause?: unknown;
    },
  ) {
    const category = classifyHTTPStatus(opts.statusCode);
    super(message, {
      category,
      retryable: opts.retryable ?? isRetryableStatus(opts.statusCode),
      statusCode: opts.statusCode,
      retryAfterMs: opts.retryAfterMs ?? parseRetryAfter(opts.responseHeaders),
      cause: opts.cause,
    });
    this.name = "APIError";
  }
}

export class ContextOverflowError extends AgentctlError {
  constructor(message?: string, cause?: unknown) {
    super(message ?? "Context window exceeded", {
      category: "context_overflow",
      retryable: false,
      cause,
    });
    this.name = "ContextOverflowError";
  }
}

export class AuthError extends AgentctlError {
  constructor(message?: string, cause?: unknown) {
    super(message ?? "Authentication failed", {
      category: "auth",
      retryable: false,
      cause,
    });
    this.name = "AuthError";
  }
}

export class ToolError extends AgentctlError {
  readonly toolName: string;

  constructor(toolName: string, message: string, cause?: unknown) {
    super(message, { category: "tool_error", retryable: false, cause });
    this.name = "ToolError";
    this.toolName = toolName;
  }
}

export class TimeoutError extends AgentctlError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message?: string, cause?: unknown) {
    super(message ?? `Operation timed out after ${timeoutMs}ms`, {
      category: "timeout",
      retryable: true,
      cause,
    });
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class AbortError extends AgentctlError {
  constructor(message?: string) {
    super(message ?? "Operation aborted", { category: "abort", retryable: false });
    this.name = "AbortError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError("Operation aborted");
}

const RETRY_INITIAL_DELAY_MS = 2000;
const RETRY_BACKOFF_FACTOR = 2;
const RETRY_MAX_DELAY_MS = 30_000;

export function retryDelay(attempt: number, error?: AgentctlError): number {
  if (error?.retryAfterMs && error.retryAfterMs > 0) {
    return error.retryAfterMs;
  }
  return Math.min(
    RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
    RETRY_MAX_DELAY_MS,
  );
}

export function formatErrorForUI(error: AgentctlError, retryMs?: number): string {
  switch (error.category) {
    case "rate_limit":
      return retryMs ? `Rate limited -- retrying in ${Math.ceil(retryMs / 1000)}s` : "Rate limited";
    case "auth":
      return "Authentication failed -- check credentials";
    case "context_overflow":
      return "Context window exceeded -- conversation too long";
    case "timeout":
      return "Request timed out -- retrying";
    case "overloaded":
      return retryMs ? `Provider overloaded -- retrying in ${Math.ceil(retryMs / 1000)}s` : "Provider overloaded";
    case "network":
      return "Network error -- check connection";
    case "abort":
      return "Aborted";
    case "tool_error":
      return `Tool error: ${error.message}`;
    default:
      return error.message;
  }
}

const OVERFLOW_PATTERNS = [
  /prompt is too long/i, /input is too long for requested model/i,
  /exceeds the context window/i, /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i, /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i, /exceeds the limit of \d+/i,
  /exceeds the available context size/i, /greater than the context length/i,
  /context window exceeds limit/i, /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
];

function isOverflowMessage(msg: string): boolean {
  return OVERFLOW_PATTERNS.some((p) => p.test(msg));
}

export function classifyError(err: unknown): AgentctlError {
  if (err instanceof AgentctlError) return err;

  if (err instanceof DOMException && err.name === "AbortError") {
    return new AbortError();
  }

  if (err instanceof Error) {
    const msg = err.message;
    const lower = msg.toLowerCase();

    if (isOverflowMessage(msg)) {
      return new ContextOverflowError(msg, err);
    }
    if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("authentication")) {
      return new AuthError(msg, err);
    }
    if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
      return new APIError(msg, { statusCode: 429, retryable: true, cause: err });
    }
    if (lower.includes("overloaded") || lower.includes("529")) {
      return new APIError(msg, { statusCode: 529, retryable: true, cause: err });
    }
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
      return new TimeoutError(0, msg, err);
    }
    if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network")) {
      return new AgentctlError(msg, { category: "network", retryable: true, cause: err });
    }

    return new AgentctlError(msg, { category: "unknown", retryable: false, cause: err });
  }

  return new AgentctlError(String(err), { category: "unknown", retryable: false });
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: {
    maxAttempts?: number;
    signal?: AbortSignal;
    onRetry?: (error: AgentctlError, attempt: number, delayMs: number) => void;
  },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts?.signal?.aborted) {
      throw new AbortError("Operation aborted before attempt");
    }
    try {
      return await fn(attempt);
    } catch (rawErr) {
      const classified = classifyError(rawErr);
      if (!classified.retryable || attempt >= maxAttempts) {
        throw classified;
      }
      const delay = retryDelay(attempt, classified);
      opts?.onRetry?.(classified, attempt, delay);
      await abortableSleep(delay, opts?.signal);
    }
  }

  throw new AgentctlError("Retry exhausted", { category: "unknown" });
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError("Aborted during retry sleep"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortError("Aborted during retry sleep"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function classifyHTTPStatus(status: number): ErrorCategory {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 529) return "overloaded";
  if (status >= 500) return "network";
  return "unknown";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

function parseRetryAfter(headers?: Record<string, string>): number | undefined {
  if (!headers) return undefined;
  const msHeader = headers["retry-after-ms"];
  if (msHeader) { const ms = parseFloat(msHeader); if (!isNaN(ms)) return ms; }
  const hdr = headers["retry-after"];
  if (hdr) {
    const sec = parseFloat(hdr);
    if (!isNaN(sec)) return Math.ceil(sec * 1000);
    const dateMs = Date.parse(hdr) - Date.now();
    if (!isNaN(dateMs) && dateMs > 0) return Math.ceil(dateMs);
  }
  return undefined;
}
