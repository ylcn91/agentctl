import { getDaemonLogPath } from "../paths";
import { LOG_MAX_BYTES, LOG_ROTATION_COUNT } from "../constants";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  msg: string;
  data?: Record<string, unknown>;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

let minLevel: LogLevel = "info";
let logPath: string | null = null;

export function setLogLevel(level: LogLevel): void { minLevel = level; }
export function setLogPath(path: string): void { logPath = path; }

function getLogFilePath(): string {
  return logPath ?? getDaemonLogPath();
}

async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return;
    if (file.size <= LOG_MAX_BYTES) return;

    const { rename, unlink } = await import("node:fs/promises");
    for (let i = LOG_ROTATION_COUNT - 1; i >= 1; i--) {
      const from = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const to = `${filePath}.${i}`;
      try { await unlink(to); } catch {}
      try { await rename(from, to); } catch {}
    }
  } catch {

  }
}

function writeEntry(entry: LogEntry): void {
  const filePath = getLogFilePath();
  const line = JSON.stringify(entry) + "\n";

  (async () => {
    try {
      await rotateIfNeeded(filePath);
      const file = Bun.file(filePath);
      const existing = (await file.exists()) ? await file.text().catch(() => "") : "";
      await Bun.write(filePath, existing + line);
    } catch {

    }
  })();

  const levelTag = entry.level.toUpperCase().padEnd(5);
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  process.stderr.write(`[${entry.component}] ${levelTag} ${entry.msg}${dataStr}\n`);
}

export function createLogger(component: string): Logger {
  function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;
    writeEntry({
      ts: new Date().toISOString(),
      level,
      component,
      msg,
      ...(data ? { data } : {}),
    });
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}
