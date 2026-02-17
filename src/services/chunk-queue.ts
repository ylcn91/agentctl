
import type { NormalizedChunk } from "./stream-normalizer";
import { CHUNK_QUEUE_BATCH_SIZE, CHUNK_QUEUE_FLUSH_DELAY_MS } from "../constants.js";

export interface ChunkQueue {
  push(chunk: NormalizedChunk): Promise<void>;
  flush(): Promise<void>;
  processed(): number;
}

export function createChunkQueue(
  consumer: (chunks: NormalizedChunk[]) => void | Promise<void>,
  batchSize = CHUNK_QUEUE_BATCH_SIZE,
): ChunkQueue {
  const buffer: NormalizedChunk[] = [];
  let flushPromise: Promise<void> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let processedCount = 0;

  async function doFlush(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, batchSize);
    processedCount += batch.length;
    await consumer(batch);
    if (buffer.length > 0) {
      await doFlush();
    }
  }

  async function scheduleFlush(): Promise<void> {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;

    if (flushPromise) {
      await flushPromise;
    }

    flushPromise = doFlush();
    await flushPromise;
    flushPromise = null;
  }

  return {
    async push(chunk: NormalizedChunk): Promise<void> {
      buffer.push(chunk);

      if (buffer.length >= batchSize) {
        await scheduleFlush();
        return;
      }

      if (!flushTimer && !flushPromise) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          scheduleFlush();
        }, CHUNK_QUEUE_FLUSH_DELAY_MS);
      }
    },

    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await scheduleFlush();
    },

    processed(): number {
      return processedCount;
    },
  };
}
