import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let testDir: string;
let savedAgentctlDir: string | undefined;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "actl-cross-deleg-"));
  savedAgentctlDir = process.env.AGENTCTL_DIR;
  process.env.AGENTCTL_DIR = testDir;
});

afterAll(async () => {
  if (savedAgentctlDir === undefined) {
    delete process.env.AGENTCTL_DIR;
  } else {
    process.env.AGENTCTL_DIR = savedAgentctlDir;
  }
  await rm(testDir, { recursive: true, force: true });
});

describe("getTasksForAccount", () => {
  test("filters tasks by assignee", async () => {
    const { getTasksForAccount } = await import("../src/services/tasks");
    const board = {
      tasks: [
        { id: "1", title: "Task A", status: "todo" as const, assignee: "alice", createdAt: "2026-01-01", events: [] },
        { id: "2", title: "Task B", status: "in_progress" as const, assignee: "bob", createdAt: "2026-01-01", events: [] },
        { id: "3", title: "Task C", status: "todo" as const, assignee: "alice", createdAt: "2026-01-01", events: [] },
      ],
    };
    const result = getTasksForAccount(board, "alice");
    expect(result.length).toBe(2);
    expect(result.every((t) => t.assignee === "alice")).toBe(true);
  });

  test("returns empty for unknown account", async () => {
    const { getTasksForAccount } = await import("../src/services/tasks");
    const board = {
      tasks: [
        { id: "1", title: "Task A", status: "todo" as const, assignee: "alice", createdAt: "2026-01-01", events: [] },
      ],
    };
    expect(getTasksForAccount(board, "nobody").length).toBe(0);
  });

  test("sorts by priority (P0 > P1 > P2)", async () => {
    const { getTasksForAccount } = await import("../src/services/tasks");
    const board = {
      tasks: [
        { id: "1", title: "Low", status: "todo" as const, assignee: "alice", priority: "P2" as const, createdAt: "2026-01-01", events: [] },
        { id: "2", title: "Critical", status: "todo" as const, assignee: "alice", priority: "P0" as const, createdAt: "2026-01-01", events: [] },
        { id: "3", title: "Medium", status: "todo" as const, assignee: "alice", priority: "P1" as const, createdAt: "2026-01-01", events: [] },
      ],
    };
    const result = getTasksForAccount(board, "alice");
    expect(result[0].priority).toBe("P0");
    expect(result[1].priority).toBe("P1");
    expect(result[2].priority).toBe("P2");
  });

  test("tasks without priority sort after P2", async () => {
    const { getTasksForAccount } = await import("../src/services/tasks");
    const board = {
      tasks: [
        { id: "1", title: "No prio", status: "todo" as const, assignee: "alice", createdAt: "2026-01-01", events: [] },
        { id: "2", title: "P1", status: "todo" as const, assignee: "alice", priority: "P1" as const, createdAt: "2026-01-01", events: [] },
      ],
    };
    const result = getTasksForAccount(board, "alice");
    expect(result[0].priority).toBe("P1");
    expect(result[1].priority).toBeUndefined();
  });
});

describe("runAcceptanceSuiteStreaming", () => {
  test("streams stdout lines", async () => {
    const { runAcceptanceSuiteStreaming } = await import("../src/services/acceptance-runner");
    const lines: { line: string; stream: string }[] = [];
    const tmpDir = await createTmpDir();

    const result = await runAcceptanceSuiteStreaming(
      ["echo hello", "echo world"],
      tmpDir,
      (line, stream) => lines.push({ line, stream }),
    );

    expect(result.passed).toBe(true);
    expect(lines.some((l) => l.line === "hello")).toBe(true);
    expect(lines.some((l) => l.line === "world")).toBe(true);

    await cleanup(tmpDir);
  });

  test("streams rejected command as stderr", async () => {
    const { runAcceptanceSuiteStreaming } = await import("../src/services/acceptance-runner");
    const lines: { line: string; stream: string }[] = [];
    const tmpDir = await createTmpDir();

    const result = await runAcceptanceSuiteStreaming(
      ["echo a && echo b"],
      tmpDir,
      (line, stream) => lines.push({ line, stream }),
    );

    expect(result.passed).toBe(false);
    expect(lines.some((l) => l.stream === "stderr" && l.line.includes("Command rejected"))).toBe(true);

    await cleanup(tmpDir);
  });

  test("handles empty command list", async () => {
    const { runAcceptanceSuiteStreaming } = await import("../src/services/acceptance-runner");
    const lines: any[] = [];
    const tmpDir = await createTmpDir();

    const result = await runAcceptanceSuiteStreaming([], tmpDir, (line) => lines.push(line));
    expect(result.passed).toBe(true);
    expect(lines.length).toBe(0);

    await cleanup(tmpDir);
  });

  test("rejects invalid workDir", async () => {
    const { runAcceptanceSuiteStreaming } = await import("../src/services/acceptance-runner");
    expect(runAcceptanceSuiteStreaming(["echo hi"], "/nonexistent-path-xyz", () => {}))
      .rejects.toThrow("workDir does not exist");
  });

  test("runs multiple commands sequentially", async () => {
    const { runAcceptanceSuiteStreaming } = await import("../src/services/acceptance-runner");
    const lines: string[] = [];
    const tmpDir = await createTmpDir();

    const result = await runAcceptanceSuiteStreaming(
      ["echo first", "echo second"],
      tmpDir,
      (line) => lines.push(line),
    );

    expect(result.passed).toBe(true);
    expect(result.results.length).toBe(2);
    expect(lines).toContain("first");
    expect(lines).toContain("second");

    await cleanup(tmpDir);
  });

  test("partial failure reports correctly", async () => {
    const { runAcceptanceSuiteStreaming } = await import("../src/services/acceptance-runner");
    const tmpDir = await createTmpDir();

    const result = await runAcceptanceSuiteStreaming(
      ["echo ok", "false"],
      tmpDir,
      () => {},
    );

    expect(result.passed).toBe(false);
    expect(result.results[0].exitCode).toBe(0);
    expect(result.results[1].exitCode).toBe(1);

    await cleanup(tmpDir);
  });
});

describe("handoff event emission", () => {
  test("registerHandoffHandlers emits TASK_CREATED and TASK_ASSIGNED", async () => {
    const { registerHandoffHandlers } = await import("../src/daemon/handlers/handoff");
    const events: any[] = [];
    const written: string[] = [];
    const ctx = {
      state: {
        eventBus: { emit: (e: any) => { events.push(e); return "id"; } },
        addMessage: () => "handoff-123",
        isConnected: () => true,
        activityStore: { emit: () => {} },
      } as any,
      features: {} as any,
      safeWrite: (_s: any, data: string) => written.push(data),
      reply: (_m: any, res: object) => JSON.stringify(res),
      getAccountName: () => "alice",
    } as any;

    const handlers = registerHandoffHandlers(ctx);
    const mockSocket = {} as any;
    await handlers.handoff_task(mockSocket, {
      type: "handoff_task",
      to: "bob",
      payload: {
        goal: "Fix the bug",
        acceptance_criteria: ["tests pass"],
        run_commands: ["bun test"],
        blocked_by: ["none"],
      },
    });

    const taskCreated = events.find((e) => e.type === "TASK_CREATED");
    const taskAssigned = events.find((e) => e.type === "TASK_ASSIGNED");
    expect(taskCreated).toBeDefined();
    expect(taskCreated.delegator).toBe("alice");
    expect(taskAssigned).toBeDefined();
    expect(taskAssigned.delegator).toBe("alice");
    expect(taskAssigned.delegatee).toBe("bob");
    expect(taskAssigned.reason).toBe("handoff_created");
  });
});

describe("TaskBoard exports", () => {
  test("tasks view is available in TUI", async () => {
    const mod = await import("../src/tui/views/tasks");
    expect(mod).toBeDefined();
  });
});

describe("event bus task events for live updates", () => {
  test("EventBus supports TASK_CREATED events", async () => {
    const { EventBus } = await import("../src/services/event-bus");
    const bus = new EventBus();
    const events: any[] = [];
    bus.on("TASK_CREATED", (e) => events.push(e));

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    expect(events.length).toBe(1);
    expect(events[0].taskId).toBe("t1");
  });

  test("EventBus supports TASK_ASSIGNED events", async () => {
    const { EventBus } = await import("../src/services/event-bus");
    const bus = new EventBus();
    const events: any[] = [];
    bus.on("TASK_ASSIGNED", (e) => events.push(e));

    bus.emit({ type: "TASK_ASSIGNED", taskId: "t1", delegator: "alice", delegatee: "bob", reason: "handoff_created" });
    expect(events.length).toBe(1);
    expect(events[0].delegatee).toBe("bob");
  });

  test("EventBus supports TDD_TEST_OUTPUT for streaming acceptance output", async () => {
    const { EventBus } = await import("../src/services/event-bus");
    const bus = new EventBus();
    const events: any[] = [];
    bus.on("TDD_TEST_OUTPUT", (e) => events.push(e));

    bus.emit({ type: "TDD_TEST_OUTPUT", testFile: "task-123", line: "PASS src/app.test.ts", stream: "stdout" });
    expect(events.length).toBe(1);
    expect(events[0].line).toBe("PASS src/app.test.ts");
    expect(events[0].stream).toBe("stdout");
  });

  test("TASK_* wildcard subscription receives task lifecycle events", async () => {
    const { EventBus } = await import("../src/services/event-bus");
    const bus = new EventBus();
    const events: any[] = [];
    bus.on("*", (e) => events.push(e));

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    bus.emit({ type: "TASK_ASSIGNED", taskId: "t1", delegator: "alice", delegatee: "bob", reason: "test" });
    bus.emit({ type: "TASK_STARTED", taskId: "t1", agent: "bob" });
    bus.emit({ type: "PROGRESS_UPDATE", taskId: "t1", agent: "bob", data: { percent: 50, currentStep: "coding" } });
    bus.emit({ type: "TASK_COMPLETED", taskId: "t1", agent: "bob", result: "success" });

    expect(events.length).toBe(5);
    expect(events.map((e) => e.type)).toEqual([
      "TASK_CREATED", "TASK_ASSIGNED", "TASK_STARTED", "PROGRESS_UPDATE", "TASK_COMPLETED",
    ]);
  });

  test("getRecent returns task events filtered by taskId", async () => {
    const { EventBus } = await import("../src/services/event-bus");
    const bus = new EventBus();

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    bus.emit({ type: "TASK_CREATED", taskId: "t2", delegator: "bob" });
    bus.emit({ type: "TASK_ASSIGNED", taskId: "t1", delegator: "alice", delegatee: "carol", reason: "test" });

    const t1Events = bus.getRecent({ taskId: "t1" });
    expect(t1Events.length).toBe(2);
    expect(t1Events.every((e: any) => e.taskId === "t1")).toBe(true);
  });
});

async function createTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "actl-test-"));
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
