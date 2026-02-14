import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { RetroStore } from "../src/services/retro-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let store: RetroStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "retro-store-test-"));
  store = new RetroStore(join(tmpDir, "retro.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("RetroStore", () => {
  test("create session and get it", () => {
    const session = store.createSession("run-1", ["alice", "bob"], "alice");
    expect(session.id).toBeDefined();
    expect(session.workflowRunId).toBe("run-1");
    expect(session.status).toBe("collecting");
    expect(session.participants).toEqual(["alice", "bob"]);
    expect(session.chairman).toBe("alice");
    expect(session.startedAt).toBeDefined();

    const fetched = store.getSession(session.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.workflowRunId).toBe("run-1");
    expect(fetched!.participants).toEqual(["alice", "bob"]);
  });

  test("get nonexistent session returns null", () => {
    expect(store.getSession("nonexistent")).toBeNull();
  });

  test("add reviews and get them", () => {
    const session = store.createSession("run-2", ["alice", "bob"], "alice");

    const review1 = store.addReview(session.id, {
      retroId: session.id,
      author: "alice",
      whatWentWell: ["fast delivery"],
      whatDidntWork: ["unclear specs"],
      suggestions: ["better docs"],
      agentPerformanceNotes: { bob: "good work" },
      submittedAt: new Date().toISOString(),
    });
    expect(review1.id).toBeDefined();
    expect(review1.author).toBe("alice");

    store.addReview(session.id, {
      retroId: session.id,
      author: "bob",
      whatWentWell: ["teamwork"],
      whatDidntWork: ["slow tests"],
      suggestions: ["parallel testing"],
      agentPerformanceNotes: {},
      submittedAt: new Date().toISOString(),
    });

    const reviews = store.getReviews(session.id);
    expect(reviews).toHaveLength(2);
    expect(reviews[0].whatWentWell).toEqual(["fast delivery"]);
    expect(reviews[1].whatWentWell).toEqual(["teamwork"]);
  });

  test("review count tracking", () => {
    const session = store.createSession("run-3", ["alice", "bob", "charlie"], "alice");
    expect(store.getReviewCount(session.id)).toBe(0);

    store.addReview(session.id, {
      retroId: session.id,
      author: "alice",
      whatWentWell: [],
      whatDidntWork: [],
      suggestions: [],
      agentPerformanceNotes: {},
      submittedAt: new Date().toISOString(),
    });
    expect(store.getReviewCount(session.id)).toBe(1);

    store.addReview(session.id, {
      retroId: session.id,
      author: "bob",
      whatWentWell: [],
      whatDidntWork: [],
      suggestions: [],
      agentPerformanceNotes: {},
      submittedAt: new Date().toISOString(),
    });
    expect(store.getReviewCount(session.id)).toBe(2);
  });

  test("store and get document", () => {
    const session = store.createSession("run-4", ["alice"], "alice");
    const docContent = JSON.stringify({ title: "Retro for run-4", learnings: ["be faster"] });

    const doc = store.storeDocument(session.id, docContent, "alice");
    expect(doc.id).toBeDefined();
    expect(doc.retroId).toBe(session.id);
    expect(doc.generatedBy).toBe("alice");

    const fetched = store.getDocument(session.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe(docContent);
    expect(fetched!.generatedBy).toBe("alice");
  });

  test("get document returns null for no doc", () => {
    const session = store.createSession("run-5", ["alice"], "alice");
    expect(store.getDocument(session.id)).toBeNull();
  });

  test("update session status", () => {
    const session = store.createSession("run-6", ["alice"], "alice");
    expect(store.getSession(session.id)!.status).toBe("collecting");

    store.updateSessionStatus(session.id, "aggregating");
    expect(store.getSession(session.id)!.status).toBe("aggregating");

    store.updateSessionStatus(session.id, "complete", new Date().toISOString());
    const completed = store.getSession(session.id)!;
    expect(completed.status).toBe("complete");
    expect(completed.completedAt).toBeDefined();
  });

  test("list sessions", () => {
    store.createSession("run-a", ["alice"], "alice");
    store.createSession("run-b", ["bob"], "bob");
    store.createSession("run-a", ["charlie"], "charlie");

    const all = store.listSessions();
    expect(all.length).toBe(3);

    const filtered = store.listSessions({ workflowRunId: "run-a" });
    expect(filtered.length).toBe(2);

    const limited = store.listSessions({ limit: 1 });
    expect(limited.length).toBe(1);
  });
});
