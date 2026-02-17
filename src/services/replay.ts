import { readCheckpoint, type TranscriptLine } from "./entire-integration";

export type ReplayEventType = "prompt" | "response" | "tool_call";

export interface ReplayEvent {
  type: ReplayEventType;
  timestamp?: string;
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  index: number;
}

export async function buildTimeline(
  repoPath: string,
  checkpointId: string,
  preReadTranscript?: TranscriptLine[],
): Promise<ReplayEvent[]> {
  const transcript = preReadTranscript ?? (await readCheckpoint(repoPath, checkpointId)).transcript;
  const events: ReplayEvent[] = [];

  for (let i = 0; i < transcript.length; i++) {
    const line = transcript[i];
    const parsed = line.parsed;

    if (!parsed) {
      continue;
    }

    const classified = classifyEvent(parsed, i);
    for (const event of classified) {
      events.push(event);
    }
  }

  return events;
}

function classifyEvent(parsed: Record<string, unknown>, index: number): ReplayEvent[] {
  if (typeof parsed !== "object" || parsed === null) return [];

  if (parsed.role === "user" || parsed.type === "human") {
    const content = extractContent(parsed);
    if (content) {
      return [{ type: "prompt", content, timestamp: parsed.timestamp as string | undefined, index }];
    }
  }

  if (parsed.role === "assistant" || parsed.type === "assistant") {
    if (Array.isArray(parsed.content)) {
      const events: ReplayEvent[] = [];
      for (const block of parsed.content) {
        if (typeof block !== "object" || block === null) continue;
        if (block.type === "tool_use") {
          events.push({
            type: "tool_call",
            content: JSON.stringify(block.input ?? {}),
            toolName: block.name as string,
            toolInput: (block.input ?? {}) as Record<string, unknown>,
            timestamp: parsed.timestamp as string | undefined,
            index,
          });
        } else if (block.type === "text" && block.text) {
          events.push({
            type: "response",
            content: block.text as string,
            timestamp: parsed.timestamp as string | undefined,
            index,
          });
        }
      }
      if (events.length > 0) return events;
    }

    const content = extractContent(parsed);
    if (content) {
      return [{ type: "response", content, timestamp: parsed.timestamp as string | undefined, index }];
    }
  }

  if (parsed.role === "tool" || parsed.type === "tool_result") {
    return [];
  }

  if (parsed.type === "tool_use") {
    return [{
      type: "tool_call",
      content: JSON.stringify((parsed.input as Record<string, unknown>) ?? {}),
      toolName: parsed.name as string,
      toolInput: (parsed.input as Record<string, unknown>) ?? {},
      timestamp: parsed.timestamp as string | undefined,
      index,
    }];
  }

  return [];
}

function extractContent(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: Record<string, unknown>) => b.type === "text")
      .map((b: Record<string, unknown>) => b.text as string)
      .join("\n");
  }
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.message === "string") return msg.message;
  return "";
}
