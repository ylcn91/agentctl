import { createConnection, type Socket } from "net";
import { getSockPath, getTokensDir } from "../paths";
import { createLineParser, frameSend, generateRequestId } from "../daemon/framing";
import type { DelegationEvent } from "./event-bus";

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const sockPath = getSockPath();
    const file = Bun.file(sockPath);
    if (!(await file.exists())) return false;
    return new Promise<boolean>((resolve) => {
      const socket = createConnection(sockPath);
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 500);
      socket.on("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.on("error", () => { clearTimeout(timer); resolve(false); });
    });
  } catch {
    return false;
  }
}

export interface StreamEvent {
  type: "stream_event";
  event: DelegationEvent & { id: string; timestamp: string };
}

export interface StreamingConnection {
  socket: Socket;
  close: () => void;
}

export async function daemonRequest(
  account: string,
  message: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const sockPath = getSockPath();
  const tokenPath = `${getTokensDir()}/${account}.token`;

  let token: string;
  try {
    token = (await Bun.file(tokenPath).text()).trim();
  } catch {
    throw new Error(`No token for account "${account}" — run: actl add ${account}`);
  }

  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    const socket = createConnection(sockPath);
    let authenticated = false;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      socket.destroy();
      settle(() => reject(new Error("Daemon request timed out")));
    }, timeoutMs);

    const parser = createLineParser((msg) => {
      if (!authenticated) {
        if (msg.type === "auth_ok") {
          authenticated = true;
          socket.write(frameSend({ ...message, requestId }));
        } else if (msg.type === "auth_fail") {
          socket.destroy();
          settle(() => reject(new Error(`Auth failed: ${msg.error}`)));
        }
        return;
      }

      if (msg.requestId === requestId || msg.type === "result" || msg.type === "error") {
        socket.destroy();
        if (msg.type === "error") {
          settle(() => reject(new Error(msg.error ?? "Daemon error")));
        } else {
          settle(() => resolve(msg));
        }
      }
    });

    socket.on("data", (data) => parser.feed(data));
    socket.on("error", (err) => {
      settle(() => reject(new Error(`Daemon connection failed: ${(err as Error).message}`)));
    });

    socket.write(frameSend({
      type: "auth",
      account,
      token,
      requestId: generateRequestId(),
    }));
  });
}

export async function daemonRequestWithProgress(
  account: string,
  message: Record<string, unknown>,
  onProgress: (event: DelegationEvent & { id: string; timestamp: string }) => void,
  timeoutMs = 180_000,
): Promise<Record<string, unknown>> {
  const sockPath = getSockPath();
  const tokenPath = `${getTokensDir()}/${account}.token`;
  let token: string;
  try {
    token = (await Bun.file(tokenPath).text()).trim();
  } catch {
    throw new Error(`No token for account "${account}" — run: actl add ${account}`);
  }

  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    const socket = createConnection(sockPath);
    let phase: "auth" | "subscribing" | "waiting" = "auth";
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      socket.destroy();
      settle(() => reject(new Error("Council request timed out")));
    }, timeoutMs);

    const parser = createLineParser((msg) => {
      if (phase === "auth") {
        if (msg.type === "auth_ok") {
          phase = "subscribing";

          socket.write(frameSend({
            type: "subscribe",
            patterns: ["AGENT_STREAM_*", "COUNCIL_*"],
            requestId: generateRequestId(),
          }));
        } else if (msg.type === "auth_fail") {
          socket.destroy();
          settle(() => reject(new Error(`Auth failed: ${msg.error}`)));
        }
        return;
      }

      if (phase === "subscribing" && msg.type === "result" && msg.subscribed) {
        phase = "waiting";

        socket.write(frameSend({ ...message, requestId }));
        return;
      }

      if (msg.type === "stream_event" && msg.event) {
        onProgress(msg.event);
        return;
      }

      if (msg.requestId === requestId || msg.type === "result" || msg.type === "error") {

        if (msg.subscribed) return;
        socket.destroy();
        if (msg.type === "error") {
          settle(() => reject(new Error(msg.error ?? "Daemon error")));
        } else {
          settle(() => resolve(msg));
        }
      }
    });

    socket.on("data", (data) => parser.feed(data));
    socket.on("error", (err) => {
      settle(() => reject(new Error(`Daemon connection failed: ${(err as Error).message}`)));
    });

    socket.write(frameSend({
      type: "auth",
      account,
      token,
      requestId: generateRequestId(),
    }));
  });
}

export async function createStreamingConnection(
  account: string,
  patterns: string[],
  onEvent: (event: DelegationEvent & { id: string; timestamp: string }) => void,
): Promise<StreamingConnection> {
  const sockPath = getSockPath();
  const tokenPath = `${getTokensDir()}/${account}.token`;
  const token = (await Bun.file(tokenPath).text()).trim();

  return new Promise((resolve, reject) => {
    const socket = createConnection(sockPath);
    let authenticated = false;

    const parser = createLineParser((msg) => {
      if (!authenticated) {
        if (msg.type === "auth_ok") {
          authenticated = true;

          socket.write(frameSend({
            type: "subscribe",
            patterns,
            requestId: generateRequestId(),
          }));
        } else if (msg.type === "auth_fail") {
          socket.destroy();
          reject(new Error(`Auth failed: ${msg.error}`));
        }
        return;
      }

      if (msg.type === "result" && msg.subscribed) {
        resolve({
          socket,
          close: () => socket.destroy(),
        });
        return;
      }

      if (msg.type === "stream_event" && msg.event) {
        onEvent(msg.event);
      }
    });

    socket.on("data", (data) => parser.feed(data));
    socket.on("error", (err) => {
      if (!authenticated) reject(err);
    });

    socket.write(frameSend({
      type: "auth",
      account,
      token,
      requestId: generateRequestId(),
    }));
  });
}
