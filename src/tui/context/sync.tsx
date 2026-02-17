
import { batch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { createSimpleContext } from "./helper.js";
import type { ChatMessage, MessagePart } from "../../services/chat-session.js";

export type PartDelta =
  | { type: "text-delta"; messageId: string; partIndex: number; text: string }
  | { type: "tool-call"; messageId: string; partIndex: number; name: string; input: unknown }
  | { type: "tool-result"; messageId: string; partIndex: number; output: unknown; status: string }
  | { type: "reasoning-delta"; messageId: string; partIndex: number; text: string }
  | { type: "message-start"; messageId: string; role: string }
  | { type: "message-end"; messageId: string };

export interface SyncSession {
  id: string;
  messages: ChatMessage[];
}

export interface SyncState {
  currentSession: string | null;
  sessions: Record<string, SyncSession>;
  parts: Record<string, MessagePart[]>;
}

const BATCH_MS = 16;

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<SyncState>({
      currentSession: null,
      sessions: {},
      parts: {},
    });

    let deltaQueue: PartDelta[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushDeltas() {
      flushTimer = null;
      if (deltaQueue.length === 0) return;
      const pending = deltaQueue;
      deltaQueue = [];

      batch(() => {
        for (const delta of pending) {
          applyDelta(delta);
        }
      });
    }

    function applyDelta(delta: PartDelta) {
      switch (delta.type) {
        case "message-start": {
          const sessionId = store.currentSession;
          if (!sessionId) return;
          const msg: ChatMessage = {
            id: delta.messageId,
            role: delta.role as "user" | "assistant",
            content: "",
            timestamp: new Date().toISOString(),
            streaming: true,
            parts: [],
          };
          setStore("sessions", sessionId, "messages", (msgs) => [...(msgs ?? []), msg]);
          setStore("parts", delta.messageId, []);
          break;
        }

        case "message-end": {
          const sessionId = store.currentSession;
          if (!sessionId) return;
          const msgs = store.sessions[sessionId]?.messages;
          if (!msgs) return;
          const idx = msgs.findIndex((m) => m.id === delta.messageId);
          if (idx === -1) return;
          setStore("sessions", sessionId, "messages", idx, "streaming", false);
          break;
        }

        case "text-delta": {
          const parts = store.parts[delta.messageId];
          if (!parts) return;
          if (delta.partIndex < parts.length && parts[delta.partIndex]?.type === "text") {
            setStore(
              "parts",
              delta.messageId,
              delta.partIndex,
              "text" as any,
              (prev: string) => (prev ?? "") + delta.text,
            );
          } else {
            setStore("parts", delta.messageId, produce((draft) => {
              while (draft.length <= delta.partIndex) {
                draft.push({ type: "text", text: "" });
              }
              draft[delta.partIndex] = { type: "text", text: delta.text };
            }));
          }
          break;
        }

        case "reasoning-delta": {
          const parts = store.parts[delta.messageId];
          if (!parts) return;
          if (delta.partIndex < parts.length && parts[delta.partIndex]?.type === "thinking") {
            setStore(
              "parts",
              delta.messageId,
              delta.partIndex,
              "text" as any,
              (prev: string) => (prev ?? "") + delta.text,
            );
          } else {
            setStore("parts", delta.messageId, produce((draft) => {
              while (draft.length <= delta.partIndex) {
                draft.push({ type: "thinking", text: "" });
              }
              draft[delta.partIndex] = { type: "thinking", text: delta.text };
            }));
          }
          break;
        }

        case "tool-call": {
          setStore("parts", delta.messageId, produce((draft) => {
            while (draft.length <= delta.partIndex) {
              draft.push({ type: "text", text: "" });
            }
            draft[delta.partIndex] = {
              type: "tool",
              name: delta.name,
              status: "running",
              input: typeof delta.input === "string" ? delta.input : JSON.stringify(delta.input ?? {}),
            };
          }));
          break;
        }

        case "tool-result": {
          const parts = store.parts[delta.messageId];
          if (!parts || delta.partIndex >= parts.length) return;
          const part = parts[delta.partIndex];
          if (part?.type !== "tool") return;
          setStore("parts", delta.messageId, delta.partIndex, reconcile({
            ...part,
            status: delta.status as any,
            output: typeof delta.output === "string" ? delta.output : JSON.stringify(delta.output ?? ""),
          }));
          break;
        }
      }
    }

    return {
      get data() { return store; },

      get messages(): ChatMessage[] {
        const sid = store.currentSession;
        if (!sid) return [];
        return store.sessions[sid]?.messages ?? [];
      },

      partsFor(messageId: string): MessagePart[] {
        return store.parts[messageId] ?? [];
      },

      get currentSession() { return store.currentSession; },

      appendPartDelta(delta: PartDelta) {
        deltaQueue.push(delta);
        if (!flushTimer) {
          flushTimer = setTimeout(flushDeltas, BATCH_MS);
        }
      },

      setMessages(messages: ChatMessage[]) {
        const sid = store.currentSession;
        if (!sid) return;
        setStore("sessions", sid, "messages", reconcile(messages));
        batch(() => {
          for (const msg of messages) {
            if (msg.parts && msg.parts.length > 0) {
              setStore("parts", msg.id, reconcile(msg.parts));
            }
          }
        });
      },

      setCurrentSession(sessionId: string) {
        if (!store.sessions[sessionId]) {
          setStore("sessions", sessionId, { id: sessionId, messages: [] });
        }
        setStore("currentSession", sessionId);
      },

      createSession(sessionId: string) {
        batch(() => {
          setStore("sessions", sessionId, { id: sessionId, messages: [] });
          setStore("currentSession", sessionId);
        });
      },

      flush() {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushDeltas();
      },
    };
  },
});
