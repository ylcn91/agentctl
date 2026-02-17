import { describe, test, expect, beforeEach } from "bun:test";
import { ProgressTracker } from "../src/services/progress-tracker";
import type { ProgressReport } from "../src/services/progress-tracker";

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  describe("report", () => {
    test("stores and returns report with timestamp", () => {
      const before = new Date().toISOString();
      const result = tracker.report({
        taskId: "t1",
        agent: "alice",
        percent: 25,
        currentStep: "parsing config",
      });
      const after = new Date().toISOString();

      expect(result.taskId).toBe("t1");
      expect(result.agent).toBe("alice");
      expect(result.percent).toBe(25);
      expect(result.currentStep).toBe("parsing config");
      expect(result.timestamp).toBeDefined();
      expect(result.timestamp >= before).toBe(true);
      expect(result.timestamp <= after).toBe(true);
    });

    test("preserves optional fields", () => {
      const result = tracker.report({
        taskId: "t1",
        agent: "alice",
        percent: 50,
        currentStep: "building",
        blockers: ["waiting on API key"],
        estimatedRemainingMinutes: 10,
        artifactsProduced: ["dist/bundle.js"],
      });

      expect(result.blockers).toEqual(["waiting on API key"]);
      expect(result.estimatedRemainingMinutes).toBe(10);
      expect(result.artifactsProduced).toEqual(["dist/bundle.js"]);
    });
  });

  describe("getLatest", () => {
    test("returns the most recent report", () => {
      tracker.report({ taskId: "t1", agent: "alice", percent: 10, currentStep: "step 1" });
      tracker.report({ taskId: "t1", agent: "alice", percent: 50, currentStep: "step 2" });
      tracker.report({ taskId: "t1", agent: "alice", percent: 80, currentStep: "step 3" });

      const latest = tracker.getLatest("t1");
      expect(latest).not.toBeNull();
      expect(latest!.percent).toBe(80);
      expect(latest!.currentStep).toBe("step 3");
    });

    test("returns null for unknown task", () => {
      expect(tracker.getLatest("nonexistent")).toBeNull();
    });
  });

  describe("getHistory", () => {
    test("returns all reports in order", () => {
      tracker.report({ taskId: "t1", agent: "alice", percent: 10, currentStep: "a" });
      tracker.report({ taskId: "t1", agent: "alice", percent: 50, currentStep: "b" });
      tracker.report({ taskId: "t1", agent: "alice", percent: 90, currentStep: "c" });

      const history = tracker.getHistory("t1");
      expect(history).toHaveLength(3);
      expect(history[0].currentStep).toBe("a");
      expect(history[1].currentStep).toBe("b");
      expect(history[2].currentStep).toBe("c");
    });

    test("returns empty array for unknown task", () => {
      expect(tracker.getHistory("nonexistent")).toEqual([]);
    });
  });

  describe("getActiveTasks", () => {
    test("lists tasks that have reports", () => {
      tracker.report({ taskId: "t1", agent: "alice", percent: 10, currentStep: "a" });
      tracker.report({ taskId: "t2", agent: "bob", percent: 20, currentStep: "b" });
      tracker.report({ taskId: "t3", agent: "carol", percent: 30, currentStep: "c" });

      const active = tracker.getActiveTasks();
      expect(active).toHaveLength(3);
      expect(active).toContain("t1");
      expect(active).toContain("t2");
      expect(active).toContain("t3");
    });

    test("returns empty array when no reports exist", () => {
      expect(tracker.getActiveTasks()).toEqual([]);
    });
  });

  describe("isStalled", () => {
    test("returns true when no report within threshold", () => {
      const report = tracker.report({ taskId: "t1", agent: "alice", percent: 30, currentStep: "waiting" });
      const history = tracker.getHistory("t1");
      history[0] = { ...history[0], timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString() };

      expect(tracker.isStalled("t1", 15)).toBe(true);
    });

    test("returns false when recent report exists", () => {
      tracker.report({ taskId: "t1", agent: "alice", percent: 30, currentStep: "working" });

      expect(tracker.isStalled("t1", 15)).toBe(false);
    });

    test("returns false for unknown task", () => {
      expect(tracker.isStalled("nonexistent", 15)).toBe(false);
    });
  });

  describe("getBehindSchedule", () => {
    test("detects tasks behind schedule", () => {
      tracker.report({ taskId: "t1", agent: "alice", percent: 20, currentStep: "slow" });
      const history = tracker.getHistory("t1");
      history[0] = { ...history[0], timestamp: new Date(Date.now() - 40 * 60 * 1000).toISOString() };

      const behind = tracker.getBehindSchedule(60);
      expect(behind).toHaveLength(1);
      expect(behind[0].taskId).toBe("t1");
      expect(behind[0].report.percent).toBe(20);
      expect(behind[0].expectedPercent).toBeGreaterThan(60);
    });

    test("ignores tasks on track", () => {
      tracker.report({ taskId: "t1", agent: "alice", percent: 80, currentStep: "almost done" });
      const history = tracker.getHistory("t1");
      history[0] = { ...history[0], timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() };

      const behind = tracker.getBehindSchedule(60);
      expect(behind).toHaveLength(0);
    });
  });

  describe("clear", () => {
    test("removes task reports", () => {
      tracker.report({ taskId: "t1", agent: "alice", percent: 50, currentStep: "half" });
      tracker.report({ taskId: "t2", agent: "bob", percent: 30, currentStep: "third" });

      tracker.clear("t1");

      expect(tracker.getLatest("t1")).toBeNull();
      expect(tracker.getHistory("t1")).toEqual([]);
      expect(tracker.getActiveTasks()).toEqual(["t2"]);
      expect(tracker.getLatest("t2")).not.toBeNull();
    });
  });

  describe("sliding window", () => {
    test("caps at 100 reports per task", () => {
      for (let i = 0; i < 120; i++) {
        tracker.report({
          taskId: "t1",
          agent: "alice",
          percent: i,
          currentStep: `step-${i}`,
        });
      }

      const history = tracker.getHistory("t1");
      expect(history).toHaveLength(100);
      // Should have kept the most recent 100 (indices 20-119)
      expect(history[0].currentStep).toBe("step-20");
      expect(history[99].currentStep).toBe("step-119");
    });
  });
});
