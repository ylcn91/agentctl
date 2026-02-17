import { readdir } from "node:fs/promises";
import { unlink } from "node:fs/promises";
import { atomicRead, atomicWrite } from "./file-store";
import { getChatSessionsDir, getChatSessionPath } from "../paths";
import type { ChatMessage } from "./chat-session";

export interface StoredSession {
  id: string;
  accountName: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  sdkSessionId?: string;
  model?: string;
  totalCost?: number;
  provider?: string;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await atomicWrite(getChatSessionPath(session.id), session);
}

export async function loadSession(id: string): Promise<StoredSession | null> {
  return atomicRead<StoredSession>(getChatSessionPath(id));
}

export async function listSessions(opts?: {
  accountName?: string;
  limit?: number;
}): Promise<StoredSession[]> {
  const dir = getChatSessionsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((e) => e.endsWith(".json"));
  const sessions: StoredSession[] = [];

  for (const file of jsonFiles) {
    const id = file.replace(/\.json$/, "");
    const session = await atomicRead<StoredSession>(getChatSessionPath(id));
    if (!session) continue;
    if (opts?.accountName && session.accountName !== opts.accountName) continue;
    sessions.push(session);
  }

  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (opts?.limit) {
    return sessions.slice(0, opts.limit);
  }
  return sessions;
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await unlink(getChatSessionPath(id));
  } catch {
  }
}
