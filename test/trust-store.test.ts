import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TrustStore, computeTrustScore, computeTrustLevel, type AgentReputation } from "../src/daemon/trust-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeReputation(overrides: Partial<AgentReputation> = {}): AgentReputation {
  return {
    accountName: "test-agent",
    totalTasksCompleted: 10,
    totalTasksFailed: 1,
    totalTasksRejected: 1,
    completionRate: 10 / 12,
    slaComplianceRate: 0.9,
    averageCompletionMinutes: 15,
    qualityVariance: 0.1,
    criticalFailureCount: 0,
    progressReportingRate: 0.8,
    trustScore: 75,
    trustLevel: "high",
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeTrustLevel", () => {
  test("high trust for score >= 70", () => {
    expect(computeTrustLevel(70)).toBe("high");
    expect(computeTrustLevel(100)).toBe("high");
  });

  test("medium trust for score 40-69", () => {
    expect(computeTrustLevel(40)).toBe("medium");
    expect(computeTrustLevel(69)).toBe("medium");
  });

  test("low trust for score < 40", () => {
    expect(computeTrustLevel(0)).toBe("low");
    expect(computeTrustLevel(39)).toBe("low");
  });
});

describe("computeTrustScore", () => {
  test("cold start returns 50", () => {
    const score = computeTrustScore({
      accountName: "new-agent",
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalTasksRejected: 0,
      completionRate: 0,
      slaComplianceRate: 1,
      averageCompletionMinutes: 0,
      qualityVariance: 0,
      criticalFailureCount: 0,
      progressReportingRate: 0,
    });
    expect(score).toBe(50);
  });

  test("perfect agent scores high", () => {
    const score = computeTrustScore({
      accountName: "perfect",
      totalTasksCompleted: 20,
      totalTasksFailed: 0,
      totalTasksRejected: 0,
      completionRate: 1.0,
      slaComplianceRate: 1.0,
      averageCompletionMinutes: 5,
      qualityVariance: 0,
      criticalFailureCount: 0,
      progressReportingRate: 1.0,
    });
    expect(score).toBeGreaterThanOrEqual(85);
  });

  test("poor agent scores low", () => {
    const score = computeTrustScore({
      accountName: "poor",
      totalTasksCompleted: 2,
      totalTasksFailed: 5,
      totalTasksRejected: 3,
      completionRate: 0.2,
      slaComplianceRate: 0.3,
      averageCompletionMinutes: 120,
      qualityVariance: 0.9,
      criticalFailureCount: 3,
      progressReportingRate: 0.1,
    });
    expect(score).toBeLessThan(40);
  });

  test("critical failures reduce quality score", () => {
    const noCritical = computeTrustScore({
      accountName: "a",
      totalTasksCompleted: 10,
      totalTasksFailed: 0,
      totalTasksRejected: 0,
      completionRate: 1,
      slaComplianceRate: 1,
      averageCompletionMinutes: 10,
      qualityVariance: 0,
      criticalFailureCount: 0,
      progressReportingRate: 0.5,
    });

    const withCritical = computeTrustScore({
      accountName: "a",
      totalTasksCompleted: 10,
      totalTasksFailed: 0,
      totalTasksRejected: 0,
      completionRate: 1,
      slaComplianceRate: 1,
      averageCompletionMinutes: 10,
      qualityVariance: 0,
      criticalFailureCount: 3,
      progressReportingRate: 0.5,
    });

    expect(noCritical).toBeGreaterThan(withCritical);
  });

  test("score clamped to 0-100", () => {
    const score = computeTrustScore({
      accountName: "a",
      totalTasksCompleted: 100,
      totalTasksFailed: 0,
      totalTasksRejected: 0,
      completionRate: 1,
      slaComplianceRate: 1,
      averageCompletionMinutes: 1,
      qualityVariance: 0,
      criticalFailureCount: 0,
      progressReportingRate: 1,
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("TrustStore", () => {
  let store: TrustStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "trust-store-"));
    store = new TrustStore(join(tmpDir, "test-trust.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true });
  });

  test("get returns null for unknown agent", () => {
    expect(store.get("unknown")).toBeNull();
  });

  test("upsert and get round-trip", () => {
    const rep = makeReputation({ accountName: "alice" });
    store.upsert(rep);

    const retrieved = store.get("alice");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.accountName).toBe("alice");
    expect(retrieved!.totalTasksCompleted).toBe(10);
    expect(retrieved!.trustScore).toBe(75);
    expect(retrieved!.trustLevel).toBe("high");
  });

  test("upsert overwrites existing", () => {
    store.upsert(makeReputation({ accountName: "alice", trustScore: 75 }));
    store.upsert(makeReputation({ accountName: "alice", trustScore: 30, trustLevel: "low" }));

    const retrieved = store.get("alice");
    expect(retrieved!.trustScore).toBe(30);
    expect(retrieved!.trustLevel).toBe("low");
  });

  test("getAll returns all agents sorted by score", () => {
    store.upsert(makeReputation({ accountName: "low", trustScore: 20, trustLevel: "low" }));
    store.upsert(makeReputation({ accountName: "high", trustScore: 90, trustLevel: "high" }));
    store.upsert(makeReputation({ accountName: "mid", trustScore: 55, trustLevel: "medium" }));

    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].accountName).toBe("high");
    expect(all[1].accountName).toBe("mid");
    expect(all[2].accountName).toBe("low");
  });

  test("recordOutcome — completed increases completed count", () => {
    store.upsert(makeReputation({ accountName: "bob", totalTasksCompleted: 5, totalTasksFailed: 0, totalTasksRejected: 0, completionRate: 1 }));
    store.recordOutcome("bob", "completed", 10);

    const updated = store.get("bob")!;
    expect(updated.totalTasksCompleted).toBe(6);
    expect(updated.completionRate).toBe(1);
  });

  test("recordOutcome — failed increases failed count and recomputes", () => {
    store.upsert(makeReputation({ accountName: "bob", totalTasksCompleted: 5, totalTasksFailed: 0, totalTasksRejected: 0, completionRate: 1 }));
    store.recordOutcome("bob", "failed");

    const updated = store.get("bob")!;
    expect(updated.totalTasksFailed).toBe(1);
    expect(updated.completionRate).toBeCloseTo(5 / 6, 2);
  });

  test("recordOutcome — rejected increases rejected count", () => {
    store.upsert(makeReputation({ accountName: "bob", totalTasksCompleted: 5, totalTasksFailed: 0, totalTasksRejected: 0, completionRate: 1 }));
    store.recordOutcome("bob", "rejected");

    const updated = store.get("bob")!;
    expect(updated.totalTasksRejected).toBe(1);
  });

  test("recordOutcome — critical failure increments critical count", () => {
    store.upsert(makeReputation({ accountName: "bob", criticalFailureCount: 0 }));
    store.recordOutcome("bob", "failed", undefined, true);

    const updated = store.get("bob")!;
    expect(updated.criticalFailureCount).toBe(1);
  });

  test("recordOutcome — creates default rep for unknown agent", () => {
    store.recordOutcome("new-agent", "completed", 5);

    const rep = store.get("new-agent");
    expect(rep).not.toBeNull();
    expect(rep!.totalTasksCompleted).toBe(1);
  });

  test("recordOutcome — updates running average completion time", () => {
    store.upsert(makeReputation({
      accountName: "bob",
      totalTasksCompleted: 4,
      totalTasksFailed: 0,
      totalTasksRejected: 0,
      completionRate: 1,
      averageCompletionMinutes: 20,
    }));
    store.recordOutcome("bob", "completed", 10);

    const updated = store.get("bob")!;
    expect(updated.averageCompletionMinutes).toBeCloseTo(18, 0);
  });

  test("recordOutcome — records history when score changes", () => {
    store.recordOutcome("alice", "completed", 5);
    store.recordOutcome("alice", "failed");

    const history = store.getHistory("alice");
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].reason).toContain("task_");
  });

  test("applyDelta adjusts score and records history", () => {
    store.upsert(makeReputation({ accountName: "alice", trustScore: 50, trustLevel: "medium" }));
    const updated = store.applyDelta("alice", -15, "consecutive_failures");

    expect(updated.trustScore).toBe(35);
    expect(updated.trustLevel).toBe("low");

    const history = store.getHistory("alice");
    expect(history).toHaveLength(1);
    expect(history[0].delta).toBe(-15);
    expect(history[0].reason).toBe("consecutive_failures");
    expect(history[0].oldScore).toBe(50);
    expect(history[0].newScore).toBe(35);
  });

  test("applyDelta clamps to 0-100", () => {
    store.upsert(makeReputation({ accountName: "alice", trustScore: 95, trustLevel: "high" }));
    const up = store.applyDelta("alice", 20, "bonus");
    expect(up.trustScore).toBe(100);

    store.upsert(makeReputation({ accountName: "bob", trustScore: 5, trustLevel: "low" }));
    const down = store.applyDelta("bob", -20, "penalty");
    expect(down.trustScore).toBe(0);
  });

  test("applyDelta creates default rep for unknown agent", () => {
    const updated = store.applyDelta("new-agent", 10, "bonus");
    expect(updated.trustScore).toBe(60);
  });

  test("getHistory returns all entries for agent", () => {
    store.upsert(makeReputation({ accountName: "alice", trustScore: 50, trustLevel: "medium" }));
    store.applyDelta("alice", 5, "first");
    store.applyDelta("alice", -3, "second");
    store.applyDelta("alice", 8, "third");

    const history = store.getHistory("alice");
    expect(history).toHaveLength(3);
    const reasons = history.map((h) => h.reason);
    expect(reasons).toContain("first");
    expect(reasons).toContain("second");
    expect(reasons).toContain("third");
  });

  test("getHistory respects limit", () => {
    store.upsert(makeReputation({ accountName: "alice", trustScore: 50, trustLevel: "medium" }));
    for (let i = 0; i < 10; i++) {
      store.applyDelta("alice", 1, `change-${i}`);
    }

    const limited = store.getHistory("alice", 3);
    expect(limited).toHaveLength(3);
  });
});
