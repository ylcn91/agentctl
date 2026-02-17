import { createServer, createConnection, type Server, type Socket } from "net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from "fs";
import { dirname } from "path";
import { timingSafeEqual } from "crypto";
import { DaemonState } from "./state";
import { createLineParser, frameSend } from "./framing";
import { DaemonMessageSchema } from "./schemas";
import { loadConfig } from "../config";
import { getHubDir, getSockPath, getPidPath, getTokensDir } from "../paths";
import { ACCOUNT_NAME_RE } from "../services/account-manager";
import { buildHandlerMap } from "./handler-registry";
import { initDaemonFeatures } from "./daemon-init";
import type { HandlerContext, DaemonFeatures } from "./handler-types";
import { MAX_PAYLOAD_BYTES, IDLE_TIMEOUT_MS } from "../constants";
import { createLogger } from "../services/logger";
const logger = createLogger("daemon");

export { DaemonFeatures };

export async function verifyAccountToken(account: string, token: string): Promise<boolean> {
  if (!ACCOUNT_NAME_RE.test(account)) return false;
  const tokenPath = `${getTokensDir()}/${account}.token`;
  try {
    const stored = (await Bun.file(tokenPath).text()).trim();
    if (stored.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(stored), Buffer.from(token));
  } catch {
    return false;
  }
}

function reply(msg: any, response: object): string {
  return frameSend({ ...response, ...(msg.requestId ? { requestId: msg.requestId } : {}) });
}

function safeWrite(socket: Socket, data: string): void {
  if (socket.destroyed || !socket.writable) return;
  const ok = socket.write(data);
  if (!ok) {
    socket.once("drain", () => {});
  }
}

export interface DaemonOpts {
  dbPath?: string;
  workspaceDbPath?: string;
  capabilityDbPath?: string;
  knowledgeDbPath?: string;
  activityDbPath?: string;
  workflowDbPath?: string;
  retroDbPath?: string;
  sessionsDbPath?: string;
  trustDbPath?: string;
  sockPath?: string;
  features?: DaemonFeatures;
  entireGitDir?: string;
  council?: { members: string[]; chairman: string; timeoutMs?: number };
}

export async function startDaemon(opts?: DaemonOpts): Promise<{ server: Server; state: DaemonState; sockPath: string; watchdog?: { stop: () => void }; sessionCleanupTimer?: ReturnType<typeof setInterval>; entireAdapter?: import("../services/entire-adapter").EntireAdapter }> {
  const state = new DaemonState(opts?.dbPath);
  const features = opts?.features;
  const councilConfig = opts?.council;

  const { watchdog, entireAdapter } = await initDaemonFeatures(state, features, {
    workspaceDbPath: opts?.workspaceDbPath,
    capabilityDbPath: opts?.capabilityDbPath,
    knowledgeDbPath: opts?.knowledgeDbPath,
    activityDbPath: opts?.activityDbPath,
    workflowDbPath: opts?.workflowDbPath,
    retroDbPath: opts?.retroDbPath,
    sessionsDbPath: opts?.sessionsDbPath,
    trustDbPath: opts?.trustDbPath,
    entireGitDir: opts?.entireGitDir,
  });

  mkdirSync(getHubDir(), { recursive: true });

  const sockPath = opts?.sockPath ?? getSockPath();
  const sockDir = dirname(sockPath);
  if (sockDir !== getHubDir()) {
    mkdirSync(sockDir, { recursive: true });
  }

  if (existsSync(sockPath)) {
    try {
      const probe = createConnection(sockPath);
      await new Promise<void>((resolve, reject) => {
        probe.once("connect", () => {
          probe.destroy();
          reject(new Error("Daemon already running"));
        });
        probe.once("error", () => {
          resolve();
        });
      });
    } catch (err: any) {
      if (err.message === "Daemon already running") throw err;
    }
    unlinkSync(sockPath);
  }

  const socketAccounts = new WeakMap<Socket, string>();

  const handlerCtx: HandlerContext = {
    state,
    features,
    councilConfig,
    safeWrite,
    reply,
    getAccountName: (socket: Socket) => socketAccounts.get(socket) ?? "",
  };
  const handlers = buildHandlerMap(handlerCtx);

  const server = createServer((socket) => {
    let authenticated = false;
    let accountName = "";
    let authAttempts = 0;
    let pendingBytes = 0;

    let idleTimer = setTimeout(() => socket.end(), IDLE_TIMEOUT_MS);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => socket.end(), IDLE_TIMEOUT_MS);
    };

    const parser = createLineParser((msg) => {
      pendingBytes = 0;
      resetIdleTimer();

      if (msg.type === "ping") {
        safeWrite(socket, reply(msg, { type: "pong" }));
        return;
      }

      if (msg.type === "config_reload") {
        (async () => {
          try {
            const config = await loadConfig();
            safeWrite(socket, reply(msg, { type: "result", reloaded: true, accounts: config.accounts.length }));
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            safeWrite(socket, reply(msg, { type: "error", error: message }));
          }
        })();
        return;
      }

      if (!authenticated) {
        if (msg.type === "auth" && msg.account && msg.token) {
          authAttempts++;
          if (authAttempts > 5) {
            socket.end();
            return;
          }
          (async () => {
            try {
              if (await verifyAccountToken(msg.account, msg.token)) {
                authenticated = true;
                accountName = msg.account;
                socketAccounts.set(socket, accountName);
                state.connectAccount(accountName, msg.token);
                safeWrite(socket, reply(msg, { type: "auth_ok" }));
              } else {
                safeWrite(socket, reply(msg, { type: "auth_fail", error: "Invalid token" }));
                socket.end();
              }
            } catch (err: any) {
              safeWrite(socket, reply(msg, { type: "auth_fail", error: err.message ?? "Auth error" }));
              socket.end();
            }
          })();
        }
        return;
      }

      const handler = handlers[msg.type];
      if (handler) {
        try {
          const result: unknown = handler(socket, msg);
          if (result instanceof Promise) {
            result.catch((err: any) => {
              logger.error(`${msg.type} async handler error`, { error: err.message ?? String(err) });
              safeWrite(socket, reply(msg, { type: "error", error: err.message ?? "Internal error" }));
            });
          }
        } catch (err: any) {
          logger.error(`${msg.type} handler error`, { error: err.message ?? String(err) });
          safeWrite(socket, reply(msg, { type: "error", error: err.message ?? "Internal error" }));
        }
      } else {
        safeWrite(socket, reply(msg, { type: "error", error: `Unknown message type: ${msg.type}` }));
      }
    }, (raw: unknown) => {
      const parsed = DaemonMessageSchema.safeParse(raw);
      if (!parsed.success) {
        if (raw && typeof raw === "object" && "type" in raw) {
          const errorDetail = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
          logger.warn(`invalid message (type=${(raw as any).type})`, { error: errorDetail });
          safeWrite(socket, reply(raw, { type: "error", error: `Invalid message: ${errorDetail}` }));
        } else {
          logger.warn("invalid message (no type)", { error: parsed.error.message });
        }
        return null;
      }
      return parsed.data;
    }, (err, rawLine) => {
      logger.error(`JSON parse error from ${accountName || "unauthenticated"}`, { error: err.message, line: rawLine.substring(0, 120) });
    });

    socket.on("data", (data) => {
      pendingBytes += data.length;
      if (pendingBytes > MAX_PAYLOAD_BYTES) {
        socket.destroy();
        return;
      }
      parser.feed(data);
    });

    socket.on("close", () => {
      clearTimeout(idleTimer);
      state.subscriptionRegistry.removeSocket(socket);
      if (accountName) state.disconnectAccount(accountName);
    });
  });

  const SESSION_CLEANUP_INTERVAL_MS = 60_000;
  const SESSION_PURGE_THRESHOLD_MS = 30 * 60_000;
  const sessionCleanupTimer = setInterval(() => {
    state.sharedSessionManager.cleanupStale();
    state.sharedSessionManager.purgeInactive(SESSION_PURGE_THRESHOLD_MS);
  }, SESSION_CLEANUP_INTERVAL_MS);

  await new Promise<void>((resolve, reject) => {
    server.once("error", (err) => {
      clearInterval(sessionCleanupTimer);
      reject(err);
    });
    server.listen(sockPath, () => {
      try { chmodSync(sockPath, 0o600); } catch {  }
      writeFileSync(getPidPath(), String(process.pid));
      resolve();
    });
  });

  return { server, state, sockPath, watchdog, sessionCleanupTimer, entireAdapter };
}

export function stopDaemon(server: Server, sockPath?: string, watchdog?: { stop: () => void }, sessionCleanupTimer?: ReturnType<typeof setInterval>, entireAdapter?: { stopWatching: () => void }): void {
  watchdog?.stop();
  entireAdapter?.stopWatching();
  if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);
  server.close();
  const sp = sockPath ?? getSockPath();
  try { unlinkSync(sp); } catch {  }
  try { unlinkSync(getPidPath()); } catch {  }
}

export function daemonStatusCommand(): string {
  const pidPath = getPidPath();
  const sockPath = getSockPath();

  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0);
      const hasSocket = existsSync(sockPath);
      return `Daemon running (PID: ${pid}${hasSocket ? ", socket: hub.sock" : ""})`;
    } catch {

      try { unlinkSync(pidPath); } catch {  }
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
