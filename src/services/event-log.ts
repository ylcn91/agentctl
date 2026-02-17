
import { getEventLogPath } from "../paths";
import type { EventBus, DelegationEvent, DelegationEventType } from "./event-bus";

const MAX_LOG_BYTES = 100 * 1024 * 1024;
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface EventLogEntry {
  id: string;
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
}

export interface EventLogOpts {
  logPath?: string;
  maxBytes?: number;
  maxAgeMs?: number;
}

export class EventLog {
  private logPath: string;
  private maxBytes: number;
  private maxAgeMs: number;
  private unsubscribe?: () => void;

  constructor(opts?: EventLogOpts) {
    this.logPath = opts?.logPath ?? getEventLogPath();
    this.maxBytes = opts?.maxBytes ?? MAX_LOG_BYTES;
    this.maxAgeMs = opts?.maxAgeMs ?? MAX_LOG_AGE_MS;
  }

  subscribe(eventBus: EventBus): () => void {
    const unsub = eventBus.on("*", (event) => {
      this.append(event);
    });
    this.unsubscribe = unsub;
    return unsub;
  }

  async append(event: DelegationEvent & { id: string; timestamp: string }): Promise<void> {
    const { type, id, timestamp, ...rest } = event;
    const entry: EventLogEntry = { id, timestamp, type, data: rest as Record<string, unknown> };
    const line = JSON.stringify(entry) + "\n";

    try {
      const file = Bun.file(this.logPath);
      const exists = await file.exists();

      if (exists) {
        const size = file.size;
        if (size > this.maxBytes) {
          await this.rotate();
        }
      }

      const fd = Bun.file(this.logPath);
      const existing = exists ? await fd.text().catch(() => "") : "";
      await Bun.write(this.logPath, existing + line);
    } catch {
    }
  }

  async query(opts?: {
    type?: string;
    since?: string;
    limit?: number;
  }): Promise<EventLogEntry[]> {
    try {
      const file = Bun.file(this.logPath);
      if (!(await file.exists())) return [];

      const content = await file.text();
      const lines = content.trim().split("\n").filter(Boolean);
      let entries: EventLogEntry[] = [];

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
        }
      }

      if (opts?.type) {
        if (opts.type.endsWith("*")) {
          const prefix = opts.type.slice(0, -1);
          entries = entries.filter((e) => e.type.startsWith(prefix));
        } else {
          entries = entries.filter((e) => e.type === opts.type);
        }
      }

      if (opts?.since) {
        entries = entries.filter((e) => e.timestamp >= opts.since!);
      }

      const limit = opts?.limit ?? entries.length;
      return entries.slice(-limit);
    } catch {
      return [];
    }
  }

  async rotate(): Promise<void> {
    try {
      const { rename, unlink } = await import("node:fs/promises");
      const oldPath = this.logPath + ".old";

      try { await unlink(oldPath); } catch {  }

      try { await rename(this.logPath, oldPath); } catch {  }
    } catch {
    }
  }

  async prune(): Promise<number> {
    try {
      const file = Bun.file(this.logPath);
      if (!(await file.exists())) return 0;

      const content = await file.text();
      const lines = content.trim().split("\n").filter(Boolean);
      const cutoff = new Date(Date.now() - this.maxAgeMs).toISOString();
      const kept: string[] = [];
      let pruned = 0;

      for (const line of lines) {
        try {
          const entry: EventLogEntry = JSON.parse(line);
          if (entry.timestamp >= cutoff) {
            kept.push(line);
          } else {
            pruned++;
          }
        } catch {
          pruned++;
        }
      }

      if (pruned > 0) {
        await Bun.write(this.logPath, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
      }

      return pruned;
    } catch {
      return 0;
    }
  }

  async size(): Promise<number> {
    try {
      const file = Bun.file(this.logPath);
      if (!(await file.exists())) return 0;
      return file.size;
    } catch {
      return 0;
    }
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}

export function parseSinceArg(since: string): string {
  const match = since.match(/^(\d+)([smhd])$/);
  if (!match) return since;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const ms = value * (multipliers[unit] ?? 60_000);
  return new Date(Date.now() - ms).toISOString();
}
