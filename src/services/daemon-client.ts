import { connect } from "net";
import { readFileSync, existsSync } from "fs";
import { createLineParser, generateRequestId, frameSend } from "../daemon/framing";

function getHubDir(): string {
  return process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
}

function getSockPath(): string {
  return `${getHubDir()}/hub.sock`;
}

function getToken(account: string): string | null {
  try {
    return readFileSync(`${getHubDir()}/tokens/${account}.token`, "utf-8").trim();
  } catch {
    return null;
  }
}

interface DaemonMessage {
  id: string;
  from: string;
  to: string;
  type: "message" | "handoff";
  content: string;
  timestamp: string;
  read: boolean;
  context?: Record<string, string>;
}

export async function fetchUnreadMessages(account: string): Promise<DaemonMessage[]> {
  const token = getToken(account);
  if (!token) return [];

  const sockPath = getSockPath();
  if (!existsSync(sockPath)) return [];

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { socket.destroy(); } catch {}
      resolve([]);
    }, 2000);

    const pending = new Map<string, { resolve: Function }>();

    const socket = connect(sockPath, () => {
      const authId = generateRequestId();
      pending.set(authId, {
        resolve: (msg: any) => {
          if (msg.type === "auth_ok") {
            const readId = generateRequestId();
            pending.set(readId, {
              resolve: (readMsg: any) => {
                clearTimeout(timeout);
                socket.end();
                resolve(readMsg.messages ?? []);
              },
            });
            socket.write(frameSend({ type: "read_messages", requestId: readId }));
          } else {
            clearTimeout(timeout);
            socket.end();
            resolve([]);
          }
        },
      });
      socket.write(frameSend({ type: "auth", account, token, requestId: authId }));
    });

    const parser = createLineParser((msg) => {
      if (msg.requestId && pending.has(msg.requestId)) {
        const entry = pending.get(msg.requestId)!;
        pending.delete(msg.requestId);
        entry.resolve(msg);
      }
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("error", () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

export async function fetchUnreadCounts(accounts: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  // Fetch in parallel
  const results = await Promise.all(
    accounts.map(async (name) => {
      const msgs = await fetchUnreadMessages(name);
      return { name, count: msgs.length };
    })
  );
  for (const { name, count } of results) {
    counts.set(name, count);
  }
  return counts;
}
