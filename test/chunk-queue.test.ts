import { test, expect, describe } from "bun:test";
import { createChunkQueue } from "../src/services/chunk-queue";
import type { NormalizedChunk } from "../src/services/stream-normalizer";
import { CHUNK_QUEUE_BATCH_SIZE, CHUNK_QUEUE_FLUSH_DELAY_MS } from "../src/constants";

function makeChunk(content: string): NormalizedChunk {
  return { chunkType: "text", content };
}

describe("createChunkQueue", () => {
  test("exports createChunkQueue function", () => {
    expect(typeof createChunkQueue).toBe("function");
  });

  test("creates a queue with push, flush, and processed methods", () => {
    const queue = createChunkQueue(() => {});
    expect(typeof queue.push).toBe("function");
    expect(typeof queue.flush).toBe("function");
    expect(typeof queue.processed).toBe("function");
  });

  test("processed starts at 0", () => {
    const queue = createChunkQueue(() => {});
    expect(queue.processed()).toBe(0);
  });

  test("flush on empty queue does nothing", async () => {
    let called = false;
    const queue = createChunkQueue(() => { called = true; });
    await queue.flush();
    expect(called).toBe(false);
    expect(queue.processed()).toBe(0);
  });

  test("single chunk flushed via explicit flush", async () => {
    const batches: NormalizedChunk[][] = [];
    const queue = createChunkQueue((batch) => { batches.push([...batch]); });
    await queue.push(makeChunk("hello"));
    await queue.flush();
    expect(batches.length).toBe(1);
    expect(batches[0].length).toBe(1);
    expect(batches[0][0].content).toBe("hello");
    expect(queue.processed()).toBe(1);
  });

  test("batch flushes at batchSize threshold", async () => {
    const batches: NormalizedChunk[][] = [];
    const queue = createChunkQueue((batch) => { batches.push([...batch]); }, 3);

    await queue.push(makeChunk("a"));
    await queue.push(makeChunk("b"));
    expect(batches.length).toBe(0);

    await queue.push(makeChunk("c"));
    expect(batches.length).toBe(1);
    expect(batches[0].length).toBe(3);
    expect(queue.processed()).toBe(3);
  });

  test("multiple batches for large input", async () => {
    const batches: NormalizedChunk[][] = [];
    const queue = createChunkQueue((batch) => { batches.push([...batch]); }, 2);

    for (let i = 0; i < 5; i++) {
      await queue.push(makeChunk(`chunk-${i}`));
    }
    await queue.flush();

    const totalProcessed = batches.reduce((sum, b) => sum + b.length, 0);
    expect(totalProcessed).toBe(5);
    expect(queue.processed()).toBe(5);
  });

  test("consumer receives chunks in order", async () => {
    const allChunks: string[] = [];
    const queue = createChunkQueue((batch) => {
      for (const c of batch) allChunks.push(c.content);
    }, 3);

    for (let i = 0; i < 7; i++) {
      await queue.push(makeChunk(`${i}`));
    }
    await queue.flush();

    expect(allChunks).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  });

  test("async consumer provides backpressure", async () => {
    let consumerBusy = false;
    let concurrentCalls = 0;
    const batches: number[] = [];

    const queue = createChunkQueue(async (batch) => {
      if (consumerBusy) concurrentCalls++;
      consumerBusy = true;
      batches.push(batch.length);
      await new Promise((r) => setTimeout(r, 10));
      consumerBusy = false;
    }, 2);

    // Push enough to trigger multiple flushes
    for (let i = 0; i < 6; i++) {
      await queue.push(makeChunk(`${i}`));
    }
    await queue.flush();

    expect(queue.processed()).toBe(6);
    // No concurrent calls — backpressure prevents overlap
    expect(concurrentCalls).toBe(0);
  });

  test("flush after push completes all pending", async () => {
    const contents: string[] = [];
    const queue = createChunkQueue((batch) => {
      for (const c of batch) contents.push(c.content);
    }, 100); // Large batch size so nothing auto-flushes

    await queue.push(makeChunk("a"));
    await queue.push(makeChunk("b"));
    await queue.push(makeChunk("c"));
    // Nothing flushed yet (batch size 100)
    expect(contents.length).toBe(0);

    await queue.flush();
    expect(contents).toEqual(["a", "b", "c"]);
    expect(queue.processed()).toBe(3);
  });

  test("debounce timer auto-flushes partial batch", async () => {
    const batches: NormalizedChunk[][] = [];
    const queue = createChunkQueue((batch) => { batches.push([...batch]); }, 100);

    await queue.push(makeChunk("auto"));
    // Wait for debounce timer to fire
    await new Promise((r) => setTimeout(r, CHUNK_QUEUE_FLUSH_DELAY_MS + 50));
    // Timer should have flushed
    expect(queue.processed()).toBe(1);
  });
});

describe("constants", () => {
  test("CHUNK_QUEUE_BATCH_SIZE is 10", () => {
    expect(CHUNK_QUEUE_BATCH_SIZE).toBe(10);
  });

  test("CHUNK_QUEUE_FLUSH_DELAY_MS is 20", () => {
    expect(CHUNK_QUEUE_FLUSH_DELAY_MS).toBe(20);
  });
});

// NOTE: SSE backpressure tests removed — SSE parsing is now handled
// internally by the Vercel AI SDK (streamText). See anthropic-client.ts.
