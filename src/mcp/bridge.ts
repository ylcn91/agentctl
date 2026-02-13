import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConnection, type Socket } from "net";
import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { registerTools, type DaemonSender } from "./tools";

const HUB_DIR = process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
const DAEMON_SOCK_PATH = `${HUB_DIR}/hub.sock`;
const DAEMON_PID_PATH = `${HUB_DIR}/daemon.pid`;
const TOKENS_DIR = `${HUB_DIR}/tokens`;

function getToken(account: string): string {
  return readFileSync(`${TOKENS_DIR}/${account}.token`, "utf-8").trim();
}

function createDaemonSender(socket: Socket): DaemonSender {
  return (msg: object) =>
    new Promise((resolve) => {
      socket.once("data", (data) => {
        resolve(JSON.parse(data.toString().trim()));
      });
      socket.write(JSON.stringify(msg) + "\n");
    });
}

function isDaemonRunning(): boolean {
  if (!existsSync(DAEMON_PID_PATH)) return false;
  try {
    const pid = parseInt(readFileSync(DAEMON_PID_PATH, "utf-8").trim(), 10);
    // process.kill with signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDaemonRunning(): Promise<void> {
  if (isDaemonRunning() && existsSync(DAEMON_SOCK_PATH)) return;

  // Spawn daemon as a detached background process
  const daemonScript = new URL("../daemon/index.ts", import.meta.url).pathname;
  const child = spawn("bun", [daemonScript], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  // Wait up to 3 seconds for hub.sock to appear
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (existsSync(DAEMON_SOCK_PATH)) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error("Daemon failed to start within 3 seconds");
}

export async function startBridge(account: string): Promise<void> {
  // Auto-start daemon if not running
  await ensureDaemonRunning();

  // Connect to daemon
  const daemonSocket = createConnection(DAEMON_SOCK_PATH);

  await new Promise<void>((resolve, reject) => {
    daemonSocket.once("connect", () => {
      // Authenticate
      const token = getToken(account);
      daemonSocket.write(JSON.stringify({ type: "auth", account, token }) + "\n");
    });

    daemonSocket.once("data", (data) => {
      const resp = JSON.parse(data.toString().trim());
      if (resp.type === "auth_ok") resolve();
      else reject(new Error(resp.error ?? "Auth failed"));
    });

    daemonSocket.once("error", reject);
  });

  // Start MCP server on stdio
  const mcpServer = new McpServer(
    { name: "claude-hub", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const sendToDaemon = createDaemonSender(daemonSocket);
  registerTools(mcpServer, sendToDaemon, account);

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
