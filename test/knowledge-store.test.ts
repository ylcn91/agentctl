import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { KnowledgeStore } from "../src/daemon/knowledge-store";
import { indexExistingPrompts, indexExistingHandoffs, indexTaskEvents } from "../src/services/knowledge-indexer";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import type { TaskBoard } from "../src/services/tasks";

const TEST_DIR = join(import.meta.dir, ".test-knowledge");
let dbCounter = 0;
function uniqueDbPath(): string {
  return join(TEST_DIR, `test-${++dbCounter}-${Date.now()}.db`);
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("KnowledgeStore", () => {
  test("constructor creates DB and tables", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const entry = store.index({
      category: "prompt",
      title: "Test",
      content: "content",
      tags: [],
    });
    expect(entry.id).toBeDefined();
    store.close();
  });

  test("index() creates entry with generated id and timestamp", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const entry = store.index({
      category: "decision_note",
      title: "Architecture Decision",
      content: "We chose SQLite for local storage",
      tags: ["architecture", "storage"],
      sourceId: "src-1",
      accountName: "claude",
    });
    expect(entry.id).toBeTruthy();
    expect(entry.indexedAt).toBeTruthy();
    expect(entry.category).toBe("decision_note");
    expect(entry.title).toBe("Architecture Decision");
    expect(entry.tags).toEqual(["architecture", "storage"]);
    expect(entry.sourceId).toBe("src-1");
    expect(entry.accountName).toBe("claude");
    store.close();
  });

  test("getById() retrieves indexed entry with parsed tags", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const entry = store.index({
      category: "prompt",
      title: "My Prompt",
      content: "Do the thing",
      tags: ["automation", "ci"],
    });
    const retrieved = store.getById(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(entry.id);
    expect(retrieved!.title).toBe("My Prompt");
    expect(retrieved!.content).toBe("Do the thing");
    expect(retrieved!.tags).toEqual(["automation", "ci"]);
    expect(retrieved!.indexedAt).toBe(entry.indexedAt);
    store.close();
  });

  test("getById() returns null for missing id", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const result = store.getById("nonexistent-id");
    expect(result).toBeNull();
    store.close();
  });

  test("search() finds entries by keyword", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    store.index({ category: "prompt", title: "Deploy Pipeline", content: "Automate deployment to production", tags: ["deploy"] });
    store.index({ category: "prompt", title: "Test Runner", content: "Run unit tests", tags: ["testing"] });

    const results = store.search("deployment");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].entry.title).toBe("Deploy Pipeline");
    expect(results[0].rank).toBeDefined();
    expect(results[0].snippet).toBeDefined();
    store.close();
  });

  test("search() with category filter", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    store.index({ category: "prompt", title: "Prompt about deploy", content: "Deploy stuff", tags: [] });
    store.index({ category: "handoff", title: "Handoff about deploy", content: "Deploy handoff", tags: [] });

    const promptResults = store.search("deploy", "prompt");
    expect(promptResults.length).toBe(1);
    expect(promptResults[0].entry.category).toBe("prompt");

    const handoffResults = store.search("deploy", "handoff");
    expect(handoffResults.length).toBe(1);
    expect(handoffResults[0].entry.category).toBe("handoff");
    store.close();
  });

  test("search() returns empty for no match", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    store.index({ category: "prompt", title: "Hello", content: "World", tags: [] });
    const results = store.search("xyzzyzzy");
    expect(results).toEqual([]);
    store.close();
  });

  test("search() ranks results (more relevant higher)", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    store.index({ category: "prompt", title: "Database Migration", content: "Database schema migration for the database layer", tags: ["database"] });
    store.index({ category: "prompt", title: "Unrelated Task", content: "This mentions database once", tags: [] });

    const results = store.search("database");
    expect(results.length).toBe(2);
    // FTS5 rank is negative; lower (more negative) = better match
    expect(results[0].rank).toBeLessThanOrEqual(results[1].rank);
    store.close();
  });

  test("delete() removes entry and returns true", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const entry = store.index({ category: "prompt", title: "To Delete", content: "Bye", tags: [] });
    const deleted = store.delete(entry.id);
    expect(deleted).toBe(true);
    expect(store.getById(entry.id)).toBeNull();
    store.close();
  });

  test("delete() returns false for missing id", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const deleted = store.delete("nonexistent");
    expect(deleted).toBe(false);
    store.close();
  });
});

describe("Knowledge Indexer", () => {
  test("indexExistingPrompts indexes all prompts", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const prompts = [
      { id: "p1", title: "Prompt One", content: "Content one", tags: ["tag1"] },
      { id: "p2", title: "Prompt Two", content: "Content two" },
      { id: "p3", title: "Prompt Three", content: "Content three", tags: ["tag2", "tag3"] },
    ];
    const count = indexExistingPrompts(store, prompts);
    expect(count).toBe(3);

    const results = store.search("Prompt");
    expect(results.length).toBe(3);
    store.close();
  });

  test("indexExistingHandoffs filters by type and indexes handoffs", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const messages = [
      { id: "m1", type: "handoff", from: "alice", to: "bob", content: "Take over the deploy" },
      { id: "m2", type: "message", from: "alice", to: "bob", content: "Just a regular message" },
      { id: "m3", type: "handoff", from: "bob", to: "carol", content: "Passing review duties" },
    ];
    const count = indexExistingHandoffs(store, messages);
    expect(count).toBe(2);

    const results = store.search("Handoff", "handoff");
    expect(results.length).toBe(2);
    store.close();
  });

  test("indexTaskEvents indexes events from task board", () => {
    const store = new KnowledgeStore(uniqueDbPath());
    const board: TaskBoard = {
      tasks: [
        {
          id: "t1",
          title: "Fix Bug",
          status: "in_progress",
          assignee: "claude",
          createdAt: new Date().toISOString(),
          events: [
            { type: "status_changed", timestamp: new Date().toISOString(), from: "todo", to: "in_progress" },
          ],
        },
        {
          id: "t2",
          title: "Add Feature",
          status: "accepted",
          assignee: "bob",
          createdAt: new Date().toISOString(),
          events: [
            { type: "status_changed", timestamp: new Date().toISOString(), from: "todo", to: "in_progress" },
            { type: "status_changed", timestamp: new Date().toISOString(), from: "in_progress", to: "ready_for_review" },
            { type: "review_accepted", timestamp: new Date().toISOString(), from: "ready_for_review", to: "accepted" },
          ],
        },
      ],
    };
    const count = indexTaskEvents(store, board);
    expect(count).toBe(4);

    const results = store.search("status_changed", "task_event");
    expect(results.length).toBeGreaterThanOrEqual(3);
    store.close();
  });
});
