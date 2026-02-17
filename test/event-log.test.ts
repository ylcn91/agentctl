import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { EventLog, parseSinceArg, type EventLogEntry } from "../src/services/event-log";
import { EventBus } from "../src/services/event-bus";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;
let logPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "event-log-test-"));
  logPath = join(tempDir, "events.ndjson");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("EventLog", () => {
  test("appends events as NDJSON lines", async () => {
    const log = new EventLog({ logPath });
    await log.append({
      type: "TASK_CREATED",
      taskId: "t1",
      delegator: "alice",
      id: "ev-1",
      timestamp: "2026-02-15T10:00:00.000Z",
    } as any);
    await log.append({
      type: "TASK_ASSIGNED",
      taskId: "t1",
      delegator: "alice",
      delegatee: "bob",
      reason: "capable",
      id: "ev-2",
      timestamp: "2026-02-15T10:01:00.000Z",
    } as any);

    const content = await Bun.file(logPath).text();
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first: EventLogEntry = JSON.parse(lines[0]);
    expect(first.id).toBe("ev-1");
    expect(first.type).toBe("TASK_CREATED");
    expect(first.data.taskId).toBe("t1");
  });

  test("query returns all events", async () => {
    const log = new EventLog({ logPath });
    await log.append({ type: "TASK_STARTED", taskId: "t1", agent: "a", id: "1", timestamp: "2026-02-15T10:00:00Z" } as any);
    await log.append({ type: "TASK_COMPLETED", taskId: "t1", agent: "a", result: "success", id: "2", timestamp: "2026-02-15T10:01:00Z" } as any);

    const entries = await log.query();
    expect(entries).toHaveLength(2);
  });

  test("query filters by exact type", async () => {
    const log = new EventLog({ logPath });
    await log.append({ type: "TASK_STARTED", taskId: "t1", agent: "a", id: "1", timestamp: "2026-02-15T10:00:00Z" } as any);
    await log.append({ type: "TASK_COMPLETED", taskId: "t1", agent: "a", result: "success", id: "2", timestamp: "2026-02-15T10:01:00Z" } as any);

    const entries = await log.query({ type: "TASK_COMPLETED" });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("TASK_COMPLETED");
  });

  test("query filters by type prefix with glob", async () => {
    const log = new EventLog({ logPath });
    await log.append({ type: "COUNCIL_SESSION_START", councilSessionId: "c1", goal: "test", stage: "analysis", members: [], id: "1", timestamp: "2026-02-15T10:00:00Z" } as any);
    await log.append({ type: "COUNCIL_SESSION_END", councilSessionId: "c1", id: "2", timestamp: "2026-02-15T10:01:00Z" } as any);
    await log.append({ type: "TASK_STARTED", taskId: "t1", agent: "a", id: "3", timestamp: "2026-02-15T10:02:00Z" } as any);

    const entries = await log.query({ type: "COUNCIL_*" });
    expect(entries).toHaveLength(2);
  });

  test("query filters by since", async () => {
    const log = new EventLog({ logPath });
    await log.append({ type: "TASK_STARTED", taskId: "t1", agent: "a", id: "1", timestamp: "2026-02-14T10:00:00Z" } as any);
    await log.append({ type: "TASK_STARTED", taskId: "t2", agent: "a", id: "2", timestamp: "2026-02-15T10:00:00Z" } as any);

    const entries = await log.query({ since: "2026-02-15T00:00:00Z" });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("2");
  });

  test("query limits results from the end", async () => {
    const log = new EventLog({ logPath });
    for (let i = 0; i < 5; i++) {
      await log.append({ type: "TASK_STARTED", taskId: `t${i}`, agent: "a", id: String(i), timestamp: `2026-02-15T10:0${i}:00Z` } as any);
    }

    const entries = await log.query({ limit: 2 });
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("3");
    expect(entries[1].id).toBe("4");
  });

  test("query returns empty for non-existent file", async () => {
    const log = new EventLog({ logPath: join(tempDir, "missing.ndjson") });
    const entries = await log.query();
    expect(entries).toHaveLength(0);
  });

  test("prune removes old entries", async () => {
    const log = new EventLog({ logPath, maxAgeMs: 24 * 60 * 60 * 1000 }); // 1 day
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();

    await log.append({ type: "TASK_STARTED", taskId: "t1", agent: "a", id: "1", timestamp: old } as any);
    await log.append({ type: "TASK_STARTED", taskId: "t2", agent: "a", id: "2", timestamp: recent } as any);

    const pruned = await log.prune();
    expect(pruned).toBe(1);

    const remaining = await log.query();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("2");
  });

  test("prune returns 0 for missing file", async () => {
    const log = new EventLog({ logPath: join(tempDir, "missing.ndjson") });
    expect(await log.prune()).toBe(0);
  });

  test("rotate renames current log to .old", async () => {
    const log = new EventLog({ logPath });
    await log.append({ type: "TASK_STARTED", taskId: "t1", agent: "a", id: "1", timestamp: "2026-02-15T10:00:00Z" } as any);

    await log.rotate();

    const oldFile = Bun.file(logPath + ".old");
    expect(await oldFile.exists()).toBe(true);

    const currentFile = Bun.file(logPath);
    expect(await currentFile.exists()).toBe(false);
  });

  test("size returns file size in bytes", async () => {
    const log = new EventLog({ logPath });
    expect(await log.size()).toBe(0);

    await log.append({ type: "TASK_STARTED", taskId: "t1", agent: "a", id: "1", timestamp: "2026-02-15T10:00:00Z" } as any);
    expect(await log.size()).toBeGreaterThan(0);
  });

  test("subscribe logs events from EventBus", async () => {
    const bus = new EventBus();
    const log = new EventLog({ logPath });
    log.subscribe(bus);

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });

    // Give async append time to complete
    await Bun.sleep(50);

    const entries = await log.query();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("TASK_CREATED");

    log.stop();
  });

  test("auto-rotates when exceeding max bytes", async () => {
    const log = new EventLog({ logPath, maxBytes: 200 }); // Tiny limit

    // Write enough data to exceed the limit
    for (let i = 0; i < 5; i++) {
      await log.append({ type: "TASK_STARTED", taskId: `t${i}`, agent: "a", id: String(i), timestamp: "2026-02-15T10:00:00Z" } as any);
    }

    const oldFile = Bun.file(logPath + ".old");
    expect(await oldFile.exists()).toBe(true);
  });
});

describe("parseSinceArg", () => {
  test("parses minutes", () => {
    const result = parseSinceArg("10m");
    const parsed = new Date(result);
    const tenMinAgo = Date.now() - 10 * 60_000;
    expect(parsed.getTime()).toBeCloseTo(tenMinAgo, -3); // within 1s
  });

  test("parses hours", () => {
    const result = parseSinceArg("2h");
    const parsed = new Date(result);
    const twoHoursAgo = Date.now() - 2 * 3_600_000;
    expect(parsed.getTime()).toBeCloseTo(twoHoursAgo, -3);
  });

  test("parses days", () => {
    const result = parseSinceArg("1d");
    const parsed = new Date(result);
    const oneDayAgo = Date.now() - 86_400_000;
    expect(parsed.getTime()).toBeCloseTo(oneDayAgo, -3);
  });

  test("parses seconds", () => {
    const result = parseSinceArg("30s");
    const parsed = new Date(result);
    const thirtySecAgo = Date.now() - 30_000;
    expect(parsed.getTime()).toBeCloseTo(thirtySecAgo, -3);
  });

  test("passes through ISO timestamp unchanged", () => {
    const iso = "2026-02-15T10:00:00Z";
    expect(parseSinceArg(iso)).toBe(iso);
  });
});
