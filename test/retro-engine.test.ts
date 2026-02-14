import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { RetroStore } from "../src/services/retro-store";
import { RetroEngine, type RetroDocument } from "../src/services/retro-engine";
import { ActivityStore } from "../src/services/activity-store";
import { KnowledgeStore } from "../src/daemon/knowledge-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let retroStore: RetroStore;
let activityStore: ActivityStore;
let knowledgeStore: KnowledgeStore;
let engine: RetroEngine;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "retro-engine-test-"));
  retroStore = new RetroStore(join(tmpDir, "retro.db"));
  activityStore = new ActivityStore(join(tmpDir, "activity.db"));
  knowledgeStore = new KnowledgeStore(join(tmpDir, "knowledge.db"));
  engine = new RetroEngine(retroStore, activityStore, knowledgeStore);
});

afterEach(() => {
  retroStore.close();
  activityStore.close();
  knowledgeStore.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeReview(author: string) {
  return {
    author,
    whatWentWell: [`${author} did great`],
    whatDidntWork: [`${author} found a bug`],
    suggestions: [`${author} suggests improvement`],
    agentPerformanceNotes: {},
    submittedAt: new Date().toISOString(),
  };
}

function makeDocument(): RetroDocument {
  return {
    title: "Test Retro",
    workflowName: "test-workflow",
    duration: "1h",
    participants: ["alice", "bob"],
    keyDecisions: [{ decision: "use Bun", rationale: "fast", outcome: "success" }],
    whatWorked: ["fast delivery"],
    whatDidntWork: ["unclear specs"],
    actionableLearnings: ["write better specs", "add more tests"],
    agentHighlights: { alice: "led design" },
    deltaFromPastRetros: ["improved test coverage since last retro"],
    generatedAt: new Date().toISOString(),
    generatedBy: "alice",
  };
}

describe("RetroEngine", () => {
  test("start retro creates session", () => {
    const session = engine.startRetro("run-1", ["alice", "bob"]);
    expect(session.id).toBeDefined();
    expect(session.workflowRunId).toBe("run-1");
    expect(session.status).toBe("collecting");
    expect(session.chairman).toBe("alice");
    expect(session.participants).toEqual(["alice", "bob"]);

    // Activity event should be emitted
    const events = activityStore.query({ type: "retro_started" });
    expect(events.length).toBe(1);
    expect(events[0].workflowRunId).toBe("run-1");
  });

  test("start retro with explicit chairman", () => {
    const session = engine.startRetro("run-2", ["alice", "bob"], "bob");
    expect(session.chairman).toBe("bob");
  });

  test("submit reviews tracks collection progress", () => {
    const session = engine.startRetro("run-3", ["alice", "bob", "charlie"]);

    const status1 = engine.submitReview(session.id, makeReview("alice"));
    expect(status1.collected).toBe(1);
    expect(status1.total).toBe(3);
    expect(status1.allCollected).toBe(false);

    const status2 = engine.submitReview(session.id, makeReview("bob"));
    expect(status2.collected).toBe(2);
    expect(status2.total).toBe(3);
    expect(status2.allCollected).toBe(false);

    const status3 = engine.submitReview(session.id, makeReview("charlie"));
    expect(status3.collected).toBe(3);
    expect(status3.total).toBe(3);
    expect(status3.allCollected).toBe(true);
  });

  test("submit review throws for nonexistent session", () => {
    expect(() => engine.submitReview("nonexistent", makeReview("alice"))).toThrow();
  });

  test("aggregation produces themes from reviews", () => {
    const session = engine.startRetro("run-4", ["alice", "bob"]);
    engine.submitReview(session.id, {
      author: "alice",
      whatWentWell: ["fast delivery", "good code"],
      whatDidntWork: ["unclear specs"],
      suggestions: ["better docs"],
      agentPerformanceNotes: {},
      submittedAt: new Date().toISOString(),
    });
    engine.submitReview(session.id, {
      author: "bob",
      whatWentWell: ["teamwork"],
      whatDidntWork: ["slow tests", "unclear specs"],
      suggestions: ["Better docs", "parallel testing"],
      agentPerformanceNotes: {},
      submittedAt: new Date().toISOString(),
    });

    const result = engine.aggregate(session.id);
    expect(result.themes.whatWorked).toEqual(["fast delivery", "good code", "teamwork"]);
    expect(result.themes.whatDidntWork).toEqual(["unclear specs", "slow tests", "unclear specs"]);
    // "Better docs" should be deduplicated with "better docs" (case-insensitive)
    expect(result.themes.topSuggestions).toEqual(["better docs", "parallel testing"]);

    // Status should be updated
    const updated = retroStore.getSession(session.id);
    expect(updated!.status).toBe("synthesizing");
  });

  test("complete synthesis stores document", async () => {
    const session = engine.startRetro("run-5", ["alice"]);
    const doc = makeDocument();

    await engine.completeSynthesis(session.id, doc);

    const stored = engine.getDocument(session.id);
    expect(stored).not.toBeNull();
    expect(stored!.title).toBe("Test Retro");
    expect(stored!.actionableLearnings).toEqual(["write better specs", "add more tests"]);

    // Session should be complete
    const updated = engine.getSession(session.id);
    expect(updated!.status).toBe("complete");
    expect(updated!.completedAt).toBeDefined();

    // Activity event should be emitted
    const events = activityStore.query({ type: "retro_completed" });
    expect(events.length).toBe(1);
  });

  test("meta-learning indexes retro in knowledge store", async () => {
    const session = engine.startRetro("run-6", ["alice"]);
    const doc = makeDocument();

    await engine.completeSynthesis(session.id, doc);

    // Knowledge store should have an entry
    const results = knowledgeStore.search("retro", "retro" as any, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.content).toContain("write better specs");
  });

  test("get past learnings returns knowledge entries", async () => {
    const session = engine.startRetro("run-7", ["alice"]);
    const doc = makeDocument();
    await engine.completeSynthesis(session.id, doc);

    const learnings = await engine.getPastLearnings();
    expect(learnings.length).toBeGreaterThan(0);
  });

  test("get past learnings returns empty without knowledge store", async () => {
    const engineNoKnowledge = new RetroEngine(retroStore, activityStore);
    const learnings = await engineNoKnowledge.getPastLearnings();
    expect(learnings).toEqual([]);
  });

  test("collection timeout with 2+ reviews proceeds to aggregation", () => {
    const session = engine.startRetro("run-8", ["alice", "bob", "charlie"]);
    engine.submitReview(session.id, makeReview("alice"));
    engine.submitReview(session.id, makeReview("bob"));

    engine.handleCollectionTimeout(session.id);

    const updated = retroStore.getSession(session.id);
    expect(updated!.status).toBe("synthesizing");
  });

  test("collection timeout with 0 reviews fails", () => {
    const session = engine.startRetro("run-9", ["alice", "bob"]);

    engine.handleCollectionTimeout(session.id);

    const updated = retroStore.getSession(session.id);
    expect(updated!.status).toBe("failed");
  });

  test("single review skips aggregation on timeout", () => {
    const session = engine.startRetro("run-10", ["alice", "bob"]);
    engine.submitReview(session.id, makeReview("alice"));

    engine.handleCollectionTimeout(session.id);

    const updated = retroStore.getSession(session.id);
    expect(updated!.status).toBe("complete");
    expect(updated!.completedAt).toBeDefined();
  });

  test("get document returns null for nonexistent", () => {
    expect(engine.getDocument("nonexistent")).toBeNull();
  });

  test("get session returns null for nonexistent", () => {
    expect(engine.getSession("nonexistent")).toBeNull();
  });
});
