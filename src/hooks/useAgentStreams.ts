import { createSignal, createMemo, onCleanup } from "solid-js";
import type { DelegationEvent, StreamChunkType } from "../services/event-bus";
import type { PartDelta } from "../tui/context/sync.js";

export interface StreamChunk {
  chunkType: StreamChunkType;
  content: string;
  toolName?: string;
  toolInput?: string;
  timestamp: string;
}

export interface AgentStream {
  sessionId: string;
  account: string;
  provider: string;
  status: "live" | "done";
  chunks: StreamChunk[];
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  tokenCount?: number;
  cost?: number;
}

export const MAX_CHUNKS_PER_STREAM = 500;
export const MAX_STREAMS = 50;
export const STREAM_TTL_MS = 5 * 60 * 1000;
export const PRUNE_INTERVAL_MS = 60 * 1000;

export function evictStreams(map: Map<string, AgentStream>, max: number): Map<string, AgentStream> {
  if (map.size <= max) return map;

  const entries = Array.from(map.entries());

  const done = entries
    .filter(([, s]) => s.status === "done")
    .sort((a, b) => (a[1].endedAt ?? "").localeCompare(b[1].endedAt ?? ""));
  const live = entries
    .filter(([, s]) => s.status === "live")
    .sort((a, b) => a[1].startedAt.localeCompare(b[1].startedAt));

  const evictionOrder = [...done, ...live];
  const toEvict = evictionOrder.slice(0, map.size - max).map(([id]) => id);

  const next = new Map(map);
  for (const id of toEvict) {
    next.delete(id);
  }
  return next;
}

export function pruneStaleDoneStreams(map: Map<string, AgentStream>, ttlMs: number, now: number): Map<string, AgentStream> {
  const cutoff = now - ttlMs;
  let pruned = false;
  const next = new Map(map);

  for (const [id, stream] of next) {
    if (stream.status === "done" && stream.endedAt) {
      const endedTime = new Date(stream.endedAt).getTime();
      if (endedTime < cutoff) {
        next.delete(id);
        pruned = true;
      }
    }
  }

  return pruned ? next : map;
}

interface SessionPartState {
  messageId: string;
  textPartIndex: number;
  thinkingPartIndex: number;
  nextPartIndex: number;
}

const sessionPartStates = new Map<string, SessionPartState>();

export function chunkToPartDelta(
  sessionId: string,
  chunk: StreamChunk,
): PartDelta | null {
  let state = sessionPartStates.get(sessionId);
  if (!state) {
    state = {
      messageId: `stream-${sessionId}`,
      textPartIndex: -1,
      thinkingPartIndex: -1,
      nextPartIndex: 0,
    };
    sessionPartStates.set(sessionId, state);
  }

  switch (chunk.chunkType) {
    case "text": {
      if (state.textPartIndex === -1) {
        state.textPartIndex = state.nextPartIndex++;
      }
      return {
        type: "text-delta",
        messageId: state.messageId,
        partIndex: state.textPartIndex,
        text: chunk.content,
      };
    }
    case "thinking": {
      if (state.thinkingPartIndex === -1) {
        state.thinkingPartIndex = state.nextPartIndex++;
      }
      return {
        type: "reasoning-delta",
        messageId: state.messageId,
        partIndex: state.thinkingPartIndex,
        text: chunk.content,
      };
    }
    case "tool_use":
      return {
        type: "tool-call",
        messageId: state.messageId,
        partIndex: state.nextPartIndex++,
        name: chunk.toolName ?? chunk.content,
        input: chunk.toolInput,
      };
    case "tool_result":

      return {
        type: "tool-result",
        messageId: state.messageId,
        partIndex: Math.max(0, state.nextPartIndex - 1),
        output: chunk.content,
        status: "completed",
      };
    default:
      return null;
  }
}

export function resetSessionPartState(sessionId: string): void {
  sessionPartStates.delete(sessionId);
}

export function useAgentStreams() {
  const [streams, setStreams] = createSignal<Map<string, AgentStream>>(new Map());

  const timer = setInterval(() => {
    setStreams((prev) => pruneStaleDoneStreams(prev, STREAM_TTL_MS, Date.now()));
  }, PRUNE_INTERVAL_MS);

  onCleanup(() => clearInterval(timer));

  const handleEvent = (event: DelegationEvent & { id: string; timestamp: string }) => {
    setStreams((prev) => {
      let next = new Map(prev);

      if (event.type === "AGENT_STREAM_START") {
        next.set(event.sessionId, {
          sessionId: event.sessionId,
          account: event.account,
          provider: event.provider,
          status: "live",
          chunks: [],
          startedAt: event.timestamp,
        });

        next = evictStreams(next, MAX_STREAMS);
      } else if (event.type === "AGENT_STREAM_CHUNK") {
        const stream = next.get(event.sessionId);
        if (stream) {
          const chunks = [...stream.chunks, {
            chunkType: event.chunkType,
            content: event.content,
            toolName: event.toolName,
            toolInput: event.toolInput,
            timestamp: event.timestamp,
          }];

          const trimmed = chunks.length > MAX_CHUNKS_PER_STREAM
            ? chunks.slice(-MAX_CHUNKS_PER_STREAM)
            : chunks;
          next.set(event.sessionId, { ...stream, chunks: trimmed });
        }
      } else if (event.type === "AGENT_STREAM_END") {
        const stream = next.get(event.sessionId);
        if (stream) {
          next.set(event.sessionId, {
            ...stream,
            status: "done",
            endedAt: event.timestamp,
            durationMs: event.durationMs,
            tokenCount: event.tokenCount,
            cost: event.cost,
          });
          resetSessionPartState(event.sessionId);
        }
      }

      return next;
    });
  };

  const activeStreams = createMemo(() =>
    Array.from(streams().values()).filter((s) => s.status === "live"),
  );
  const allStreams = createMemo(() => Array.from(streams().values()));

  return {
    get streams() { return streams(); },
    get allStreams() { return allStreams(); },
    get activeStreams() { return activeStreams(); },
    handleEvent,
  };
}
