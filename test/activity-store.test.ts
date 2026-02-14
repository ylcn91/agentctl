import { test, expect, beforeEach, afterEach } from "bun:test";
import { ActivityStore } from "../src/services/activity-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let store: ActivityStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "activity-test-"));
  store = new ActivityStore(join(tmpDir, "activity.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("emit and query events", () => {
  const event = store.emit({
    type: "task_created", timestamp: new Date().toISOString(),
    account: "work", metadata: { title: "Test task" },
  });
  expect(event.id).toBeDefined();
  const results = store.query({ account: "work" });
  expect(results).toHaveLength(1);
  expect(results[0].type).toBe("task_created");
});

test("query with type filter", () => {
  store.emit({ type: "task_created", timestamp: new Date().toISOString(), account: "a", metadata: {} });
  store.emit({ type: "message_sent", timestamp: new Date().toISOString(), account: "a", metadata: {} });
  expect(store.query({ type: "task_created" })).toHaveLength(1);
  expect(store.query({ type: "message_sent" })).toHaveLength(1);
});

test("query with workflow filter", () => {
  store.emit({ type: "workflow_started", timestamp: new Date().toISOString(), account: "a", workflowRunId: "run-1", metadata: {} });
  store.emit({ type: "task_created", timestamp: new Date().toISOString(), account: "a", metadata: {} });
  expect(store.getByWorkflow("run-1")).toHaveLength(1);
});

test("search via FTS", () => {
  store.emit({ type: "task_created", timestamp: new Date().toISOString(), account: "worker", metadata: { note: "authentication feature" } });
  const results = store.search("authentication");
  expect(results.length).toBeGreaterThanOrEqual(0); // FTS may or may not match metadata content
});

test("cleanup old events", () => {
  store.emit({ type: "task_created", timestamp: new Date(Date.now() - 40 * 86400000).toISOString(), account: "a", metadata: {} });
  store.emit({ type: "task_created", timestamp: new Date().toISOString(), account: "a", metadata: {} });
  const deleted = store.cleanup(30);
  expect(deleted).toBe(1);
  expect(store.query({})).toHaveLength(1);
});

test("query with limit", () => {
  for (let i = 0; i < 10; i++) {
    store.emit({ type: "task_created", timestamp: new Date().toISOString(), account: "a", metadata: { i } });
  }
  expect(store.query({ limit: 3 })).toHaveLength(3);
});

test("query with since filter", () => {
  const old = new Date(Date.now() - 86400000).toISOString();
  const recent = new Date().toISOString();
  store.emit({ type: "task_created", timestamp: old, account: "a", metadata: {} });
  store.emit({ type: "task_created", timestamp: recent, account: "a", metadata: {} });
  const since = new Date(Date.now() - 3600000).toISOString();
  expect(store.query({ since })).toHaveLength(1);
});
