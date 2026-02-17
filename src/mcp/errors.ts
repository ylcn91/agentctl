
import { classifyError, type AgentctlError, type ErrorCategory } from "../services/errors";

export type MCPErrorCode =
  | "AUTH_FAILED"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "OVERFLOW"
  | "INTERNAL";

export interface MCPToolError {
  code: MCPErrorCode;
  message: string;
  retryable: boolean;
  tool?: string;
}

const CATEGORY_TO_CODE: Record<ErrorCategory, MCPErrorCode> = {
  auth: "AUTH_FAILED",
  rate_limit: "RATE_LIMITED",
  timeout: "TIMEOUT",
  context_overflow: "OVERFLOW",
  network: "INTERNAL",
  overloaded: "RATE_LIMITED",
  tool_error: "INTERNAL",
  abort: "INTERNAL",
  unknown: "INTERNAL",
};

export function toMCPError(err: unknown, toolName?: string): MCPToolError {
  const classified = classifyError(err);
  const code = categorizeMCPError(classified);

  return {
    code,
    message: classified.message,
    retryable: classified.retryable,
    tool: toolName,
  };
}

function categorizeMCPError(err: AgentctlError): MCPErrorCode {
  const categoryCode = CATEGORY_TO_CODE[err.category];
  if (categoryCode && categoryCode !== "INTERNAL") {
    return categoryCode;
  }

  const lower = err.message.toLowerCase();
  if (lower.includes("not found") || lower.includes("does not exist") || lower.includes("no such")) {
    return "NOT_FOUND";
  }
  if (lower.includes("validation") || lower.includes("invalid") || lower.includes("required")) {
    return "VALIDATION";
  }

  return "INTERNAL";
}

export function formatMCPErrorResponse(error: MCPToolError): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        error: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.tool ? { tool: error.tool } : {}),
      }),
    }],
    isError: true,
  };
}

export function wrapMCPHandler<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | ReturnType<typeof formatMCPErrorResponse>> {
  return async (args: TArgs) => {
    try {
      return await handler(args);
    } catch (err) {
      const mcpError = toMCPError(err, toolName);
      return formatMCPErrorResponse(mcpError);
    }
  };
}
