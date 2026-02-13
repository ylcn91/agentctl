import { createServer, type Server } from "net";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { DaemonState } from "./state";
import { createLineParser, frameSend } from "./framing";
import { notifyHandoff, notifyMessage } from "../services/notifications";
import { validateHandoff } from "../services/handoff";
import { loadTasks, saveTasks, updateTaskStatus, rejectTask, acceptTask, type TaskStatus } from "../services/tasks";

function getHubDir(): string {
  return process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
}

function getSockPath(): string {
  return `${getHubDir()}/hub.sock`;
}

function getPidPath(): string {
  return `${getHubDir()}/daemon.pid`;
}

function getTokensDir(): string {
  return `${getHubDir()}/tokens`;
}

export function verifyAccountToken(account: string, token: string): boolean {
  const tokenPath = `${getTokensDir()}/${account}.token`;
  try {
    const stored = readFileSync(tokenPath, "utf-8").trim();
    return stored === token;
  } catch {
    return false;
  }
}

function reply(msg: any, response: object): string {
  return frameSend({ ...response, ...(msg.requestId ? { requestId: msg.requestId } : {}) });
}

export function startDaemon(opts?: { dbPath?: string }): { server: Server; state: DaemonState } {
  const state = new DaemonState(opts?.dbPath);
  const sockPath = getSockPath();

  // Cleanup orphaned socket
  if (existsSync(sockPath)) unlinkSync(sockPath);

  const server = createServer((socket) => {
    let authenticated = false;
    let accountName = "";

    const parser = createLineParser((msg) => {
      // First message must be auth handshake
      if (!authenticated) {
        if (msg.type === "auth" && msg.account && msg.token) {
          if (verifyAccountToken(msg.account, msg.token)) {
            authenticated = true;
            accountName = msg.account;
            state.connectAccount(accountName, msg.token);
            socket.write(reply(msg, { type: "auth_ok" }));
          } else {
            socket.write(reply(msg, { type: "auth_fail", error: "Invalid token" }));
            socket.end();
          }
        }
        return;
      }

      // Handle message types
      if (msg.type === "send_message") {
        state.addMessage({
          from: accountName,
          to: msg.to,
          type: "message",
          content: msg.content,
          timestamp: new Date().toISOString(),
        });
        // Fire notification (non-blocking)
        notifyMessage(accountName, msg.to, msg.content).catch(() => {});
        socket.write(reply(msg, { type: "result", delivered: state.isConnected(msg.to), queued: true }));
      }

      if (msg.type === "read_messages") {
        const limit = msg.limit as number | undefined;
        const offset = msg.offset as number | undefined;
        const messages = (limit || offset)
          ? state.getMessages(accountName, { limit, offset })
          : state.getUnreadMessages(accountName);
        if (!limit && !offset) {
          state.markAllRead(accountName);
        }
        socket.write(reply(msg, { type: "result", messages }));
      }

      if (msg.type === "list_accounts") {
        const accounts = state.getConnectedAccounts().map((name) => ({
          name,
          status: "active" as const,
        }));
        socket.write(reply(msg, { type: "result", accounts }));
      }

      if (msg.type === "handoff_task") {
        // Server-side validation (bypass protection)
        const validation = validateHandoff(msg.payload);
        if (!validation.valid) {
          socket.write(reply(msg, {
            type: "error",
            error: "Invalid handoff payload",
            details: validation.errors,
          }));
          return;
        }

        const handoffMsg = {
          from: accountName,
          to: msg.to,
          type: "handoff" as const,
          content: JSON.stringify(validation.payload),
          timestamp: new Date().toISOString(),
          context: msg.context ?? {},
        };
        const handoffId = state.addMessage(handoffMsg);
        // Fire notification (non-blocking)
        notifyHandoff(accountName, msg.to, validation.payload.goal).catch(() => {});
        socket.write(reply(msg, {
          type: "result",
          delivered: state.isConnected(msg.to),
          queued: true,
          handoffId,
        }));
      }

      if (msg.type === "update_task_status") {
        (async () => {
          try {
            let board = await loadTasks();
            const status = msg.status as TaskStatus;

            if (status === "rejected") {
              if (!msg.reason) {
                socket.write(reply(msg, { type: "error", error: "Reason is required when rejecting" }));
                return;
              }
              board = rejectTask(board, msg.taskId, msg.reason);
            } else if (status === "accepted") {
              board = acceptTask(board, msg.taskId);
            } else {
              board = updateTaskStatus(board, msg.taskId, status);
            }

            await saveTasks(board);
            const task = board.tasks.find((t) => t.id === msg.taskId);
            socket.write(reply(msg, { type: "result", task }));
          } catch (err: any) {
            socket.write(reply(msg, { type: "error", error: err.message }));
          }
        })();
      }

      if (msg.type === "archive_messages") {
        const archived = state.archiveOld(msg.days);
        socket.write(reply(msg, { type: "result", archived }));
      }
    });

    socket.on("data", (data) => parser.feed(data));

    socket.on("close", () => {
      if (accountName) state.disconnectAccount(accountName);
    });
  });

  server.listen(sockPath, () => {
    writeFileSync(getPidPath(), String(process.pid));
  });

  return { server, state };
}

export function stopDaemon(server: Server): void {
  server.close();
  try { unlinkSync(getSockPath()); } catch {}
  try { unlinkSync(getPidPath()); } catch {}
}

export function daemonStatusCommand(): string {
  const pidPath = getPidPath();
  const sockPath = getSockPath();

  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0); // signal 0 = existence check
      const hasSocket = existsSync(sockPath);
      return `Daemon running (PID: ${pid}${hasSocket ? ", socket: hub.sock" : ""})`;
    } catch {
      // Process not alive -- stale PID file
      try { unlinkSync(pidPath); } catch {}
      return "Daemon not running (stale PID file removed)";
    }
  } catch {
    return "Daemon not running";
  }
}

export function stopDaemonByPid(): void {
  const pidPath = getPidPath();
  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (pid ${pid})`);
  } catch {
    console.log("No running daemon found");
  }
}
