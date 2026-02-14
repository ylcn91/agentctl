import { test, expect, describe, beforeEach } from "bun:test";
import {
  AdaptiveCoordinator,
  DEFAULT_ADAPTIVE_CONFIG,
  type TaskState,
  type ResponseAction,
} from "../src/services/adaptive-coordinator";

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    taskId: "task-1",
    status: "in_progress",
    assignee: "agent-a",
    reassignmentCount: 0,
    startedAt: new Date(Date.now() - 45 * 60_000).toISOString(), // 45 min ago
    ...overrides,
  };
}

function minutesAgo(n: number, base: Date = new Date()): Date {
  return new Date(base.getTime() - n * 60_000);
}

describe("AdaptiveCoordinator", () => {
  let coordinator: AdaptiveCoordinator;
  const now = new Date("2026-02-14T12:00:00Z");

  beforeEach(() => {
    coordinator = new AdaptiveCoordinator();
  });

  describe("default config", () => {
    test("has correct default values", () => {
      expect(DEFAULT_ADAPTIVE_CONFIG.pingAfterMinutes).toBe(30);
      expect(DEFAULT_ADAPTIVE_CONFIG.suggestReassignAfterMinutes).toBe(60);
      expect(DEFAULT_ADAPTIVE_CONFIG.autoReassignCriticalAfterMinutes).toBe(60);
      expect(DEFAULT_ADAPTIVE_CONFIG.unresponsiveThresholdMinutes).toBe(10);
      expect(DEFAULT_ADAPTIVE_CONFIG.maxReassignments).toBe(3);
      expect(DEFAULT_ADAPTIVE_CONFIG.cooldownMinutes).toBe(10);
      expect(DEFAULT_ADAPTIVE_CONFIG.consecutiveRejectionsForPenalty).toBe(2);
      expect(DEFAULT_ADAPTIVE_CONFIG.behindScheduleThresholdPercent).toBe(20);
    });
  });

  describe("fresh tasks produce no actions", () => {
    test("task started 10 minutes ago produces no actions", () => {
      const task = makeTask({
        startedAt: minutesAgo(10, now).toISOString(),
      });
      const actions = coordinator.evaluate([task], now);
      expect(actions).toHaveLength(0);
    });

    test("task started 29 minutes ago produces no actions", () => {
      const task = makeTask({
        startedAt: minutesAgo(29, now).toISOString(),
      });
      const actions = coordinator.evaluate([task], now);
      expect(actions).toHaveLength(0);
    });
  });

  describe("ping after 30 minutes", () => {
    test("emits ping for task in_progress > 30 min", () => {
      const task = makeTask({
        startedAt: minutesAgo(35, now).toISOString(),
      });
      const actions = coordinator.evaluate([task], now);
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe("ping");
      const ping = actions[0] as Extract<ResponseAction, { action: "ping" }>;
      expect(ping.taskId).toBe("task-1");
      expect(ping.agent).toBe("agent-a");
    });

    test("does not ping for non-in_progress tasks", () => {
      const task = makeTask({
        status: "todo",
        startedAt: minutesAgo(120, now).toISOString(),
      });
      const actions = coordinator.evaluate([task], now);
      // Only consecutive rejection actions could appear, but there are none
      expect(actions.filter((a) => a.action === "ping")).toHaveLength(0);
    });
  });

  describe("suggest reassign after 60 minutes", () => {
    test("emits suggest_reassign for task in_progress > 60 min", () => {
      const task = makeTask({
        startedAt: minutesAgo(65, now).toISOString(),
      });
      const actions = coordinator.evaluate([task], now);
      const reassigns = actions.filter((a) => a.action === "suggest_reassign");
      expect(reassigns).toHaveLength(1);
      const sr = reassigns[0] as Extract<ResponseAction, { action: "suggest_reassign" }>;
      expect(sr.taskId).toBe("task-1");
      expect(sr.currentAgent).toBe("agent-a");
    });
  });

  describe("auto-reassign critical tasks after 60 min", () => {
    test("emits auto_reassign for critical task > 60 min", () => {
      const task = makeTask({
        startedAt: minutesAgo(65, now).toISOString(),
        criticality: "critical",
      });
      const actions = coordinator.evaluate([task], now);
      const autoReassigns = actions.filter((a) => a.action === "auto_reassign");
      expect(autoReassigns).toHaveLength(1);
      const ar = autoReassigns[0] as Extract<ResponseAction, { action: "auto_reassign" }>;
      expect(ar.taskId).toBe("task-1");
      expect(ar.from).toBe("agent-a");
      expect(ar.to).toBe("");
    });

    test("does not auto-reassign non-critical task > 60 min", () => {
      const task = makeTask({
        startedAt: minutesAgo(65, now).toISOString(),
        criticality: "high",
      });
      const actions = coordinator.evaluate([task], now);
      const autoReassigns = actions.filter((a) => a.action === "auto_reassign");
      expect(autoReassigns).toHaveLength(0);
    });
  });

  describe("escalate when maxReassignments reached", () => {
    test("emits escalate_human instead of reassign when maxReassignments reached", () => {
      const task = makeTask({
        startedAt: minutesAgo(65, now).toISOString(),
        criticality: "critical",
        reassignmentCount: 3,
      });
      const actions = coordinator.evaluate([task], now);
      const escalations = actions.filter((a) => a.action === "escalate_human");
      expect(escalations).toHaveLength(1);
      expect(escalations[0].action).toBe("escalate_human");
      const esc = escalations[0] as Extract<ResponseAction, { action: "escalate_human" }>;
      expect(esc.taskId).toBe("task-1");

      // Should not auto_reassign
      const autoReassigns = actions.filter((a) => a.action === "auto_reassign");
      expect(autoReassigns).toHaveLength(0);
    });
  });

  describe("cooldown prevents rapid reassignment", () => {
    test("canReassign returns true for new task", () => {
      expect(coordinator.canReassign("task-1", now)).toBe(true);
    });

    test("canReassign returns false within cooldown period", () => {
      coordinator.recordReassignment("task-1");
      // Immediately after reassignment — should be in cooldown
      expect(coordinator.canReassign("task-1")).toBe(false);
    });

    test("canReassign returns true after cooldown period", () => {
      coordinator.recordReassignment("task-1");
      // 11 minutes later
      const later = new Date(Date.now() + 11 * 60_000);
      expect(coordinator.canReassign("task-1", later)).toBe(true);
    });

    test("critical task not auto-reassigned during cooldown", () => {
      // First, record a recent reassignment
      const recentReassignment = new Date(now.getTime() - 5 * 60_000); // 5 min ago
      coordinator = new AdaptiveCoordinator();
      // Manually set the last reassignment timestamp
      (coordinator as any).lastReassignment.set("task-1", recentReassignment.getTime());

      const task = makeTask({
        startedAt: minutesAgo(65, now).toISOString(),
        criticality: "critical",
      });
      const actions = coordinator.evaluate([task], now);
      const autoReassigns = actions.filter((a) => a.action === "auto_reassign");
      expect(autoReassigns).toHaveLength(0);

      // Should fall through to suggest_reassign instead
      const suggests = actions.filter((a) => a.action === "suggest_reassign");
      expect(suggests).toHaveLength(1);
    });
  });

  describe("unresponsive agent detection", () => {
    test("quarantines agent with stale progress report", () => {
      const task = makeTask({
        startedAt: minutesAgo(35, now).toISOString(),
        lastProgressReport: {
          percent: 40,
          timestamp: minutesAgo(15, now).toISOString(), // 15 min ago, threshold is 10
        },
      });
      const actions = coordinator.evaluate([task], now);
      const quarantines = actions.filter((a) => a.action === "quarantine_agent");
      expect(quarantines).toHaveLength(1);
      const q = quarantines[0] as Extract<ResponseAction, { action: "quarantine_agent" }>;
      expect(q.agent).toBe("agent-a");
    });

    test("does not quarantine agent with recent progress report", () => {
      const task = makeTask({
        startedAt: minutesAgo(35, now).toISOString(),
        lastProgressReport: {
          percent: 40,
          timestamp: minutesAgo(5, now).toISOString(), // 5 min ago, threshold is 10
        },
      });
      const actions = coordinator.evaluate([task], now);
      const quarantines = actions.filter((a) => a.action === "quarantine_agent");
      expect(quarantines).toHaveLength(0);
    });
  });

  describe("behind schedule detection", () => {
    test("emits proactive_warning when task is behind schedule", () => {
      const task = makeTask({
        startedAt: minutesAgo(50, now).toISOString(),
        estimatedDurationMinutes: 60,
        lastProgressReport: {
          percent: 30, // Expected ~83%, way behind
          timestamp: minutesAgo(1, now).toISOString(),
        },
      });
      const actions = coordinator.evaluate([task], now);
      const warnings = actions.filter((a) => a.action === "proactive_warning");
      expect(warnings).toHaveLength(1);
      const w = warnings[0] as Extract<ResponseAction, { action: "proactive_warning" }>;
      expect(w.taskId).toBe("task-1");
      expect(w.agent).toBe("agent-a");
    });

    test("does not warn when task is on schedule", () => {
      const task = makeTask({
        startedAt: minutesAgo(30, now).toISOString(),
        estimatedDurationMinutes: 60,
        lastProgressReport: {
          percent: 50, // Expected ~50%, on track
          timestamp: minutesAgo(1, now).toISOString(),
        },
      });
      const actions = coordinator.evaluate([task], now);
      const warnings = actions.filter((a) => a.action === "proactive_warning");
      expect(warnings).toHaveLength(0);
    });

    test("does not warn without estimatedDurationMinutes", () => {
      const task = makeTask({
        startedAt: minutesAgo(50, now).toISOString(),
        lastProgressReport: {
          percent: 10,
          timestamp: minutesAgo(1, now).toISOString(),
        },
      });
      const actions = coordinator.evaluate([task], now);
      const warnings = actions.filter((a) => a.action === "proactive_warning");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("consecutive rejections trigger quarantine", () => {
    test("quarantines agent with consecutive rejections at threshold", () => {
      const rejections = new Map<string, number>();
      rejections.set("agent-b", 2);
      const task = makeTask({
        status: "todo", // doesn't need to be in_progress for rejection check
        consecutiveRejectionsBy: rejections,
      });
      const actions = coordinator.evaluate([task], now);
      const quarantines = actions.filter((a) => a.action === "quarantine_agent");
      expect(quarantines).toHaveLength(1);
      const q = quarantines[0] as Extract<ResponseAction, { action: "quarantine_agent" }>;
      expect(q.agent).toBe("agent-b");
    });

    test("does not quarantine agent below rejection threshold", () => {
      const rejections = new Map<string, number>();
      rejections.set("agent-b", 1);
      const task = makeTask({
        consecutiveRejectionsBy: rejections,
      });
      const actions = coordinator.evaluate([task], now);
      const quarantines = actions.filter(
        (a) => a.action === "quarantine_agent" && (a as any).agent === "agent-b",
      );
      expect(quarantines).toHaveLength(0);
    });
  });

  describe("multiple tasks in single call", () => {
    test("evaluates all tasks and returns combined actions", () => {
      const tasks: TaskState[] = [
        makeTask({
          taskId: "task-1",
          startedAt: minutesAgo(35, now).toISOString(),
        }),
        makeTask({
          taskId: "task-2",
          assignee: "agent-b",
          startedAt: minutesAgo(65, now).toISOString(),
        }),
        makeTask({
          taskId: "task-3",
          assignee: "agent-c",
          startedAt: minutesAgo(10, now).toISOString(),
        }),
      ];
      const actions = coordinator.evaluate(tasks, now);

      // task-1: ping (35 min)
      const pings = actions.filter(
        (a) => a.action === "ping" && (a as any).taskId === "task-1",
      );
      expect(pings).toHaveLength(1);

      // task-2: suggest_reassign (65 min)
      const suggests = actions.filter(
        (a) => a.action === "suggest_reassign" && (a as any).taskId === "task-2",
      );
      expect(suggests).toHaveLength(1);

      // task-3: nothing (10 min)
      const task3Actions = actions.filter(
        (a) => "taskId" in a && (a as any).taskId === "task-3",
      );
      expect(task3Actions).toHaveLength(0);
    });
  });

  describe("custom config", () => {
    test("respects custom pingAfterMinutes", () => {
      const custom = new AdaptiveCoordinator({ pingAfterMinutes: 10 });
      const task = makeTask({
        startedAt: minutesAgo(15, now).toISOString(),
      });
      const actions = custom.evaluate([task], now);
      const pings = actions.filter((a) => a.action === "ping");
      expect(pings).toHaveLength(1);
    });

    test("respects custom maxReassignments", () => {
      const custom = new AdaptiveCoordinator({ maxReassignments: 1 });
      const task = makeTask({
        startedAt: minutesAgo(65, now).toISOString(),
        criticality: "critical",
        reassignmentCount: 1,
      });
      const actions = custom.evaluate([task], now);
      const escalations = actions.filter((a) => a.action === "escalate_human");
      expect(escalations).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    test("task without startedAt produces no time-based actions", () => {
      const task = makeTask({
        startedAt: undefined,
      });
      const actions = coordinator.evaluate([task], now);
      expect(actions).toHaveLength(0);
    });

    test("empty tasks array returns empty actions", () => {
      const actions = coordinator.evaluate([], now);
      expect(actions).toHaveLength(0);
    });
  });
});
