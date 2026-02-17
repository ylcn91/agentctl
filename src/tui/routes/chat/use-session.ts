
import { createSignal, batch, type Accessor, type Setter } from "solid-js";
import { ChatSession, type ChatMessage } from "../../../services/chat-session.js";
import { saveSession, loadSession, type StoredSession } from "../../../services/chat-store.js";
import type { AccountConfig } from "../../../types.js";
import type { StreamingChunk } from "./tool-results.js";

export interface AccountSessionSnapshot {
  sessionId: string;
  session: ChatSession;
  messages: ChatMessage[];
  cost: number;
  backgroundStreaming: boolean;
  streamingChunks: StreamingChunk[];
  scrollOffset: number;
  autoScroll: boolean;
  model?: string;
}

export interface SessionManager {
  messages: Accessor<ChatMessage[]>;
  setMessages: Setter<ChatMessage[]>;
  streaming: Accessor<boolean>;
  setStreaming: Setter<boolean>;
  streamingChunks: Accessor<StreamingChunk[]>;
  setStreamingChunks: Setter<StreamingChunk[]>;
  account: Accessor<AccountConfig | null>;
  error: Accessor<string | null>;
  setError: Setter<string | null>;
  totalCost: Accessor<number>;
  setTotalCost: Setter<number>;
  currentModel: Accessor<string | undefined>;

  getSession: () => ChatSession | null;
  getSessionId: () => string | null;
  getAccountSessions: () => Map<string, AccountSessionSnapshot>;

  persistSession: () => Promise<void>;
  switchAccount: (acc: AccountConfig) => void;
  newSession: (acc?: AccountConfig) => void;
  loadSessionById: (id: string, targetAccount?: AccountConfig) => Promise<void>;
  abort: () => void;
  clear: () => void;
  setModelOverride: (model: string | undefined) => void;
  sendGeneration: Accessor<number>;
  bumpSendGeneration: () => number;
}

export function createSessionManager(
  scrollOffset: Accessor<number>,
  autoScroll: Accessor<boolean>,
  setScrollOffset: Setter<number>,
  setAutoScroll: Setter<boolean>,
): SessionManager {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [streaming, setStreaming] = createSignal(false);
  const [streamingChunks, setStreamingChunks] = createSignal<StreamingChunk[]>([]);
  const [account, setAccount] = createSignal<AccountConfig | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [totalCost, setTotalCost] = createSignal(0);
  const [currentModel, setCurrentModel] = createSignal<string | undefined>(undefined);
  const [sendGeneration, setSendGeneration] = createSignal(0);

  let sessionRef: ChatSession | null = null;
  let currentSessionId: string | null = null;
  const accountSessions = new Map<string, AccountSessionSnapshot>();

  async function persistSession() {
    if (!currentSessionId || !account()) return;
    const msgs = sessionRef?.getMessages() ?? [];
    if (msgs.length === 0) return;

    const firstUserMsg = msgs.find((m) => m.role === "user");
    const title = firstUserMsg ? firstUserMsg.content.slice(0, 80) : "Untitled";

    const stored: StoredSession = {
      id: currentSessionId!,
      accountName: account()!.name,
      title,
      messages: msgs,
      createdAt: msgs[0]?.timestamp ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sdkSessionId: sessionRef?.getSessionId(),
      model: sessionRef?.getModel(),
      totalCost: totalCost() || undefined,
      provider: account()!.provider,
    };
    await saveSession(stored).catch(() => {});
  }

  function switchAccount(acc: AccountConfig) {
    persistSession();
    setSendGeneration(g => g + 1);
    const curAcc = account();
    if (curAcc && sessionRef && currentSessionId) {
      accountSessions.set(curAcc.name, {
        sessionId: currentSessionId,
        session: sessionRef,
        messages: messages(),
        cost: totalCost(),
        backgroundStreaming: streaming(),
        streamingChunks: streamingChunks(),
        scrollOffset: scrollOffset(),
        autoScroll: autoScroll(),
        model: sessionRef.getModel(),
      });
    }

    const cached = accountSessions.get(acc.name);
    if (cached) {
      sessionRef = cached.session;
      currentSessionId = cached.sessionId;
      batch(() => {
        setAccount(acc);
        setMessages(cached.messages);
        setStreamingChunks([...cached.streamingChunks]);
        setStreaming(cached.backgroundStreaming);
        setError(null);
        setTotalCost(cached.cost);
        setCurrentModel(cached.model);
        setAutoScroll(cached.autoScroll);
        setScrollOffset(cached.scrollOffset);
      });
    } else {
      const newId = crypto.randomUUID();
      sessionRef = new ChatSession(acc);
      currentSessionId = newId;
      batch(() => {
        setAccount(acc);
        setMessages([]);
        setStreamingChunks([]);
        setStreaming(false);
        setError(null);
        setTotalCost(0);
        setCurrentModel(undefined);
        setAutoScroll(true);
        setScrollOffset(0);
      });
    }
  }

  function newSession(acc?: AccountConfig) {
    persistSession();
    setSendGeneration(g => g + 1);
    const target = acc ?? account();
    if (!target) return;
    sessionRef?.abort();
    accountSessions.delete(target.name);
    const newId = crypto.randomUUID();
    sessionRef = new ChatSession(target);
    currentSessionId = newId;
    batch(() => {
      setAccount(target);
      setMessages([]);
      setStreamingChunks([]);
      setStreaming(false);
      setError(null);
      setTotalCost(0);
    });
  }

  async function loadSessionById(id: string, targetAccount?: AccountConfig) {
    persistSession();
    const stored = await loadSession(id);
    if (!stored) return;
    sessionRef?.abort();
    const acc = targetAccount ?? account();
    if (acc) {
      sessionRef = new ChatSession(acc);
      setAccount(acc);
    }
    if (sessionRef) {
      sessionRef.restoreMessages(stored.messages);
      if (stored.sdkSessionId) sessionRef.restoreSdkSession(stored.sdkSessionId);
      if (stored.model) sessionRef.setModel(stored.model);
    }
    currentSessionId = stored.id;
    batch(() => {
      setMessages(stored.messages);
      setStreamingChunks([]);
      setStreaming(false);
      setError(null);
      setCurrentModel(stored.model);
      const cost = stored.totalCost ?? stored.messages
        .filter((m) => m.cost != null)
        .reduce((sum, m) => sum + (m.cost ?? 0), 0);
      setTotalCost(cost);
    });
  }

  function abort() {
    sessionRef?.abort();
    setStreaming(false);
    setStreamingChunks([]);
  }

  function clear() {
    sessionRef?.clear();
    const curAcc = account();
    if (curAcc) accountSessions.delete(curAcc.name);
    batch(() => {
      setMessages([]);
      setStreamingChunks([]);
      setError(null);
      setTotalCost(0);
    });
    currentSessionId = crypto.randomUUID();
  }

  function setModelOverride(model: string | undefined) {
    setCurrentModel(model);
    sessionRef?.setModel(model);
    const acc = account();
    if (acc) {
      const snap = accountSessions.get(acc.name);
      if (snap) snap.model = model;
    }
  }

  return {
    messages, setMessages,
    streaming, setStreaming,
    streamingChunks, setStreamingChunks,
    account,
    error, setError,
    totalCost, setTotalCost,
    currentModel,
    getSession: () => sessionRef,
    getSessionId: () => currentSessionId,
    getAccountSessions: () => accountSessions,
    persistSession,
    switchAccount,
    newSession,
    loadSessionById,
    abort,
    clear,
    setModelOverride,
    sendGeneration,
    bumpSendGeneration() {
      const next = sendGeneration() + 1;
      setSendGeneration(next);
      return next;
    },
  };
}
