import { useState, useCallback, useRef } from "react";
import type { AccountConfig } from "../types";
import type { NormalizedChunk } from "../services/stream-normalizer";
import { ChatSession, type ChatMessage } from "../services/chat-session";
import { saveSession, loadSession } from "../services/chat-store";
import type { StoredSession } from "../services/chat-store";
import { useChunkBatching } from "./useChunkBatching";
import type { StreamingChunk, AccountSnapshot } from "./useChunkBatching";

export type { ChatMessage } from "../services/chat-session";
export type { StoredSession } from "../services/chat-store";
export type { StreamingChunk, AccountSnapshot } from "./useChunkBatching";

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [account, setAccountState] = useState<AccountConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | undefined>(undefined);
  const sessionRef = useRef<ChatSession | null>(null);

  const accountSessionsRef = useRef<Map<string, AccountSnapshot>>(new Map());

  const sessionIdRef = useRef<string | null>(null);
  const accountRef = useRef<AccountConfig | null>(null);
  const streamingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const costRef = useRef(0);
  const scrollStateRef = useRef<{ offset: number; auto: boolean }>({ offset: 0, auto: true });
  sessionIdRef.current = currentSessionId;
  accountRef.current = account;
  streamingRef.current = streaming;
  messagesRef.current = messages;
  costRef.current = totalCost;

  const {
    streamingChunks, streamingChunksRef, setStreamingChunks,
    chunkBufferRef, queueChunk, clearChunkBuffer,
  } = useChunkBatching(accountRef, accountSessionsRef);

  const syncRefs = (acc: AccountConfig, sid: string, msgs: ChatMessage[], cost: number, isStreaming: boolean) => {
    accountRef.current = acc; sessionIdRef.current = sid;
    messagesRef.current = msgs; costRef.current = cost; streamingRef.current = isStreaming;
  };

  const persistSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    const acc = accountRef.current;
    if (!sid || !acc) return;
    const msgs = sessionRef.current?.getMessages() ?? [];
    if (msgs.length === 0) return;

    const firstUserMsg = msgs.find((m) => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 80)
      : "Untitled";

    const stored: StoredSession = {
      id: sid,
      accountName: acc.name,
      title,
      messages: msgs,
      createdAt: msgs[0]?.timestamp ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sdkSessionId: sessionRef.current?.getSessionId(),
      model: sessionRef.current?.getModel(),
      totalCost: costRef.current || undefined,
      provider: acc.provider,
    };
    await saveSession(stored).catch(() => {});
  }, []);

  const send = useCallback(async (text: string) => {
    if (!sessionRef.current) return;
    if (streamingRef.current) {
      setError("Waiting for response... (press ^C to abort)");
      return;
    }
    setError(null);

    const pinnedSession = sessionRef.current;
    const pinnedAccount = accountRef.current;
    const pinnedSessionId = sessionIdRef.current;
    const pinnedAccountName = pinnedAccount?.name;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);
    setStreamingChunks([]);
    clearChunkBuffer();

    try {
      const msg = await pinnedSession.send(text, (chunk: NormalizedChunk) => {
        if (chunk.chunkType === "system") return;
        const streamChunk: StreamingChunk = {
          chunkType: chunk.chunkType,
          content: chunk.content,
          toolName: chunk.toolName,
          toolInput: chunk.toolInput,
        };
        queueChunk(streamChunk, pinnedAccountName);
      });

      const stillViewing = accountRef.current?.name === pinnedAccountName;
      if (stillViewing) {
        clearChunkBuffer();
        setMessages(pinnedSession.getMessages());
        setStreamingChunks([]);
        if (msg.cost) setTotalCost((prev) => prev + msg.cost!);
      } else {
        if (pinnedAccountName) {
          const existing = accountSessionsRef.current.get(pinnedAccountName);
          accountSessionsRef.current.set(pinnedAccountName, {
            sessionId: pinnedSessionId ?? crypto.randomUUID(),
            session: pinnedSession,
            messages: pinnedSession.getMessages(),
            cost: costRef.current + (msg.cost ?? 0),
            backgroundStreaming: false,
            chunkBuffer: [],
            streamingChunks: existing?.streamingChunks ?? [],
            scrollOffset: existing?.scrollOffset ?? 0,
            autoScroll: existing?.autoScroll ?? true,
            model: pinnedSession.getModel(),
          });
        }
      }
      await persistSession();
    } catch (err) {
      const stillViewingOnError = accountRef.current?.name === pinnedAccountName;
      if (stillViewingOnError) {
        setError(err instanceof Error ? err.message : String(err));
        setMessages(pinnedSession.getMessages());
      } else if (pinnedAccountName) {
        const existing = accountSessionsRef.current.get(pinnedAccountName);
        accountSessionsRef.current.set(pinnedAccountName, {
          sessionId: pinnedSessionId ?? crypto.randomUUID(),
          session: pinnedSession,
          messages: pinnedSession.getMessages(),
          cost: costRef.current,
          backgroundStreaming: false,
          chunkBuffer: [],
          streamingChunks: existing?.streamingChunks ?? [],
          scrollOffset: existing?.scrollOffset ?? 0,
          autoScroll: existing?.autoScroll ?? true,
          model: pinnedSession.getModel(),
        });
      }
    } finally {
      const stillViewingOnFinally = accountRef.current?.name === pinnedAccountName;
      if (stillViewingOnFinally) {
        setStreaming(false);
        setStreamingChunks([]);
        clearChunkBuffer();
      }
    }
  }, [persistSession, queueChunk, clearChunkBuffer, setStreamingChunks]);

  const switchAccount = useCallback((acc: AccountConfig) => {
    persistSession();
    const curAcc = accountRef.current;
    if (curAcc && sessionRef.current && sessionIdRef.current) {
      accountSessionsRef.current.set(curAcc.name, {
        sessionId: sessionIdRef.current,
        session: sessionRef.current,
        messages: messagesRef.current,
        cost: costRef.current,
        backgroundStreaming: streamingRef.current,
        chunkBuffer: [...chunkBufferRef.current],
        streamingChunks: streamingChunksRef.current,
        scrollOffset: scrollStateRef.current.offset,
        autoScroll: scrollStateRef.current.auto,
        model: sessionRef.current.getModel(),
      });
    }
    clearChunkBuffer();

    const cached = accountSessionsRef.current.get(acc.name);
    if (cached) {
      const isStreaming = cached.backgroundStreaming ?? false;
      sessionRef.current = cached.session;
      setAccountState(acc); setMessages(cached.messages);
      setStreamingChunks([...cached.streamingChunks, ...cached.chunkBuffer]);
      chunkBufferRef.current = [];
      setStreaming(isStreaming); setError(null);
      setTotalCost(cached.cost); setCurrentSessionId(cached.sessionId); setCurrentModel(cached.model);
      scrollStateRef.current = { offset: cached.scrollOffset, auto: cached.autoScroll };
      syncRefs(acc, cached.sessionId, cached.messages, cached.cost, isStreaming);
    } else {
      const newId = crypto.randomUUID();
      sessionRef.current = new ChatSession(acc);
      setAccountState(acc); setMessages([]); setStreamingChunks([]);
      setStreaming(false); setError(null); setTotalCost(0);
      setCurrentSessionId(newId); setCurrentModel(undefined);
      scrollStateRef.current = { offset: 0, auto: true };
      syncRefs(acc, newId, [], 0, false);
    }
  }, [persistSession, clearChunkBuffer, chunkBufferRef, streamingChunksRef, setStreamingChunks]);

  const newSession = useCallback((acc?: AccountConfig) => {
    persistSession();
    const target = acc ?? accountRef.current;
    if (!target) return;
    sessionRef.current?.abort();
    accountSessionsRef.current.delete(target.name);
    const newId = crypto.randomUUID();
    sessionRef.current = new ChatSession(target);
    setAccountState(target);
    setMessages([]);
    setStreamingChunks([]);
    setStreaming(false);
    setError(null);
    setTotalCost(0);
    setCurrentSessionId(newId);
    clearChunkBuffer();
  }, [persistSession, clearChunkBuffer, setStreamingChunks]);

  const loadSessionById = useCallback(async (id: string, targetAccount?: AccountConfig) => {
    persistSession();
    const stored = await loadSession(id);
    if (!stored) return;
    sessionRef.current?.abort();
    const acc = targetAccount ?? accountRef.current;
    if (acc) {
      sessionRef.current = new ChatSession(acc);
      setAccountState(acc);
    }
    if (sessionRef.current) {
      sessionRef.current.restoreMessages(stored.messages);
      if (stored.sdkSessionId) sessionRef.current.restoreSdkSession(stored.sdkSessionId);
      if (stored.model) sessionRef.current.setModel(stored.model);
    }
    setMessages(stored.messages);
    setStreamingChunks([]);
    setStreaming(false);
    setError(null);
    setCurrentSessionId(stored.id);
    setCurrentModel(stored.model);
    clearChunkBuffer();
    const cost = stored.totalCost ?? stored.messages
      .filter((m) => m.cost != null)
      .reduce((sum, m) => sum + (m.cost ?? 0), 0);
    setTotalCost(cost);
  }, [persistSession, clearChunkBuffer, setStreamingChunks]);

  const abort = useCallback(() => {
    sessionRef.current?.abort();
    setStreaming(false);
    setStreamingChunks([]);
    clearChunkBuffer();
  }, [clearChunkBuffer, setStreamingChunks]);

  const clear = useCallback(() => {
    sessionRef.current?.clear();
    const curAcc = accountRef.current;
    if (curAcc) accountSessionsRef.current.delete(curAcc.name);
    setMessages([]);
    setStreamingChunks([]);
    setError(null);
    setTotalCost(0);
    setCurrentSessionId(crypto.randomUUID());
    clearChunkBuffer();
  }, [clearChunkBuffer, setStreamingChunks]);

  const setModel = useCallback((model: string | undefined) => {
    setCurrentModel(model);
    sessionRef.current?.setModel(model);
    const acc = accountRef.current;
    if (acc) {
      const snap = accountSessionsRef.current.get(acc.name);
      if (snap) snap.model = model;
    }
  }, []);

  return {
    messages, streaming, streamingChunks, account, error, totalCost,
    currentSessionId, currentModel, scrollStateRef,
    send, switchAccount, newSession, loadSessionById, abort, clear, setModel,
  };
}
