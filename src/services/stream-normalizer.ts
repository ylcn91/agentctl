import type { StreamChunkType } from "./event-bus";
import type { ProviderId } from "../types";

export interface NormalizedChunk {
  chunkType: StreamChunkType;
  content: string;
  toolName?: string;
  toolInput?: string;
  tokenUsage?: { input?: number; output?: number };
  cost?: number;
}

export function normalizeClaudeCodeEvent(json: any): NormalizedChunk | null {
  if (!json || typeof json !== "object") return null;

  if (json.type === "system") {
    return { chunkType: "system", content: json.subtype ?? "session_start" };
  }

  if (json.type === "assistant") {
    const msg = json.message;
    if (!msg?.content) return null;
    const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];
    for (const block of blocks) {
      if (typeof block === "string") {
        return { chunkType: "text", content: block };
      }
      if (block.type === "text") {
        return { chunkType: "text", content: block.text ?? "" };
      }
      if (block.type === "thinking") {
        return { chunkType: "thinking", content: block.thinking ?? "" };
      }
      if (block.type === "tool_use") {
        return {
          chunkType: "tool_use",
          content: block.name ?? "unknown_tool",
          toolName: block.name,
          toolInput: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
        };
      }
      if (block.type === "tool_result") {
        return {
          chunkType: "tool_result",
          content: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""),
        };
      }
    }
    return null;
  }

  if (json.type === "result") {
    const u = json.usage;
    const totalInput = u
      ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      : undefined;
    return {
      chunkType: "system",
      content: json.result ?? "",
      cost: json.total_cost_usd ?? json.cost_usd ?? json.cost,
      tokenUsage: u
        ? { input: totalInput || u.input_tokens, output: u.output_tokens }
        : undefined,
    };
  }

  return null;
}

export function normalizeOpenCodeEvent(json: any): NormalizedChunk | null {
  if (!json || typeof json !== "object") return null;
  const part = json.part;

  if (json.type === "text") {
    return { chunkType: "text", content: part?.text ?? json.text ?? "" };
  }
  if (json.type === "reasoning") {
    return { chunkType: "thinking", content: part?.text ?? json.reasoning ?? "" };
  }
  if (json.type === "tool_call" || json.type === "tool_use") {
    const name = part?.name ?? json.name ?? "tool";
    const input = part?.input ?? json.input;
    return {
      chunkType: "tool_use",
      content: name,
      toolName: name,
      toolInput: typeof input === "string" ? input : JSON.stringify(input ?? {}),
    };
  }
  if (json.type === "tool_result") {
    return { chunkType: "tool_result", content: part?.output ?? json.output ?? "" };
  }
  if (json.type === "step_finish") {
    const tokens = part?.tokens;
    return {
      chunkType: "system",
      content: part?.reason ?? "done",
      tokenUsage: tokens
        ? { input: tokens.input, output: tokens.output }
        : undefined,
      cost: part?.cost ?? json.cost,
    };
  }
  if (json.type === "session.status" || json.type === "session.complete") {
    return {
      chunkType: "system",
      content: json.status ?? json.type,
      tokenUsage: json.usage
        ? { input: json.usage.input_tokens, output: json.usage.output_tokens }
        : undefined,
      cost: json.cost,
    };
  }
  return null;
}

export function normalizePlainTextLine(line: string): NormalizedChunk {
  return { chunkType: "text", content: line };
}

export function getNormalizer(provider: ProviderId): (input: any) => NormalizedChunk | null {
  switch (provider) {
    case "claude-code":
    case "cursor-agent":
      return normalizeClaudeCodeEvent;
    case "opencode":
      return normalizeOpenCodeEvent;
    case "codex-cli":
    case "gemini-cli":
    case "openhands":
      return (line: any) => {
        if (typeof line === "string") return normalizePlainTextLine(line);
        if (typeof line === "object" && line !== null) {
          return normalizePlainTextLine(JSON.stringify(line));
        }
        return null;
      };
    default:
      return (line: any) => normalizePlainTextLine(String(line));
  }
}
