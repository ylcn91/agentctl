
import { batch } from "solid-js";
import type { NormalizedChunk } from "../../../services/stream-normalizer.js";
import type { ChatMessage } from "../../../services/chat-session.js";
import type { StreamingChunk } from "./tool-results.js";
import { MAX_STREAMING_CHUNKS } from "./helpers.js";
import type { SessionManager } from "./use-session.js";

const FLUSH_MS = 16;

export interface SendController {
  send: (text: string) => Promise<void>;
}

export function createSendController(session: SessionManager): SendController {
  let inFlightGen: number | null = null;

  async function send(text: string) {
    const pinnedSession = session.getSession();
    if (!pinnedSession) return;

    if (inFlightGen === session.sendGeneration()) return;

    if (session.streaming()) {
      session.abort();
    }

    const pinnedAccountName = session.account()?.name;
    const gen = session.bumpSendGeneration();
    inFlightGen = gen;

    const chunkQueue: StreamingChunk[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushChunks() {
      flushTimer = null;
      if (chunkQueue.length === 0) return;
      if (session.sendGeneration() !== gen) return;
      const pending = chunkQueue.splice(0);
      batch(() => {
        session.setStreamingChunks((prev) => {
          const next = [...prev, ...pending];
          return next.length > MAX_STREAMING_CHUNKS
            ? next.slice(-MAX_STREAMING_CHUNKS)
            : next;
        });
      });
    }

    function enqueueChunk(sc: StreamingChunk) {
      chunkQueue.push(sc);
      if (!flushTimer) {
        flushTimer = setTimeout(flushChunks, FLUSH_MS);
      }
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    batch(() => {
      session.setError(null);
      session.setMessages((prev) => [...prev, userMsg]);
      session.setStreaming(true);
      session.setStreamingChunks([]);
    });

    try {
      const msg = await pinnedSession.send(text, (chunk: NormalizedChunk) => {
        if (chunk.chunkType === "system") return;
        const sc: StreamingChunk = {
          chunkType: chunk.chunkType,
          content: chunk.content,
          toolName: chunk.toolName,
          toolInput: chunk.toolInput,
        };
        if (session.sendGeneration() === gen) {
          enqueueChunk(sc);
        }
      });

      if (session.sendGeneration() === gen) {
        batch(() => {
          session.setStreaming(false);
          session.setMessages(pinnedSession.getMessages());
          session.setStreamingChunks([]);
          if (msg.cost) session.setTotalCost((prev) => prev + msg.cost!);
        });
      } else {
        const snap = session.getAccountSessions().get(pinnedAccountName!);
        if (snap) {
          snap.backgroundStreaming = false;
          snap.streamingChunks = [];
          snap.messages = pinnedSession.getMessages();
          if (msg.cost) snap.cost += msg.cost;
        }
        if (session.account()?.name === pinnedAccountName) {
          batch(() => {
            session.setStreaming(false);
            session.setMessages(pinnedSession.getMessages());
            session.setStreamingChunks([]);
            if (msg.cost) session.setTotalCost((prev) => prev + msg.cost!);
          });
        }
      }
      await session.persistSession();
    } catch (err) {
      if (session.sendGeneration() === gen) {
        batch(() => {
          session.setStreaming(false);
          session.setError(err instanceof Error ? err.message : String(err));
          session.setMessages(pinnedSession.getMessages());
          session.setStreamingChunks([]);
        });
      } else {
        const snap = session.getAccountSessions().get(pinnedAccountName!);
        if (snap) {
          snap.backgroundStreaming = false;
          snap.streamingChunks = [];
          snap.messages = pinnedSession.getMessages();
        }
        if (session.account()?.name === pinnedAccountName) {
          batch(() => {
            session.setStreaming(false);
            session.setError(err instanceof Error ? err.message : String(err));
            session.setMessages(pinnedSession.getMessages());
            session.setStreamingChunks([]);
          });
        }
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      try { flushChunks(); } catch {}
      if (session.sendGeneration() === gen) {
        batch(() => {
          session.setStreaming(false);
          session.setStreamingChunks([]);
        });
      } else {
        const snap = session.getAccountSessions().get(pinnedAccountName!);
        if (snap) {
          snap.backgroundStreaming = false;
          snap.streamingChunks = [];
        }
        if (session.account()?.name === pinnedAccountName) {
          batch(() => {
            session.setStreaming(false);
            session.setStreamingChunks([]);
          });
        }
      }
      if (inFlightGen === gen) inFlightGen = null;
    }
  }

  return { send };
}
