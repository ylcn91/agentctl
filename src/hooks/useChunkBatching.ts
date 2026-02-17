
import { batch, onCleanup } from "solid-js";
import type { PartDelta } from "../tui/context/sync.js";

export interface StreamingChunk {
  chunkType: string;
  content: string;
  toolName?: string;
  toolInput?: string;
}

export interface AccountSnapshot {
  sessionId: string;
  session: any;
  messages: any[];
  cost: number;
  backgroundStreaming?: boolean;
  chunkBuffer: StreamingChunk[];
  streamingChunks: StreamingChunk[];
  scrollOffset: number;
  autoScroll: boolean;
  model?: string;
}

const DELTA_FLUSH_INTERVAL = 16;

export function createDeltaBatcher(consumer: (deltas: PartDelta[]) => void) {
  const buffer: PartDelta[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    flushTimer = null;
    if (buffer.length === 0) return;
    const pending = buffer.splice(0);
    batch(() => {
      consumer(pending);
    });
  }

  function queue(delta: PartDelta) {
    buffer.push(delta);
    if (!flushTimer) {
      flushTimer = setTimeout(flush, DELTA_FLUSH_INTERVAL);
    }
  }

  function clear() {
    buffer.length = 0;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function forceFlush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  }

  try {
    onCleanup(clear);
  } catch {
  }

  return { queue, clear, flush: forceFlush };
}

export function createChunkBatcher(
  getActiveAccount: () => string | undefined,
  getAccountSessions: () => Map<string, AccountSnapshot>,
) {
  const buffer: StreamingChunk[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let onFlush: ((chunks: StreamingChunk[]) => void) | null = null;

  function flush() {
    flushTimer = null;
    if (buffer.length === 0) return;
    const pending = buffer.splice(0);
    batch(() => {
      onFlush?.(pending);
    });
  }

  function queue(chunk: StreamingChunk, targetAccount?: string) {
    const activeAccount = getActiveAccount();
    if (targetAccount && targetAccount !== activeAccount) {
      const snap = getAccountSessions().get(targetAccount);
      if (snap) snap.chunkBuffer.push(chunk);
      return;
    }
    buffer.push(chunk);
    if (!flushTimer) {
      flushTimer = setTimeout(flush, DELTA_FLUSH_INTERVAL);
    }
  }

  function clear() {
    buffer.length = 0;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  try {
    onCleanup(clear);
  } catch {
  }

  return {
    queue,
    clear,
    setOnFlush(fn: (chunks: StreamingChunk[]) => void) { onFlush = fn; },
  };
}
