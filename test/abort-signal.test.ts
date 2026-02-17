import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { throwIfAborted, AbortError } from "../src/services/errors";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let testDir: string;
let savedAgentctlDir: string | undefined;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "actl-abort-signal-"));
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

describe("throwIfAborted", () => {
  test("does nothing when signal is undefined", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  test("does nothing when signal is not aborted", () => {
    const ac = new AbortController();
    expect(() => throwIfAborted(ac.signal)).not.toThrow();
  });

  test("throws AbortError when signal is aborted", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => throwIfAborted(ac.signal)).toThrow(AbortError);
  });

  test("thrown error has category 'abort'", () => {
    const ac = new AbortController();
    ac.abort();
    try {
      throwIfAborted(ac.signal);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AbortError);
      expect((err as AbortError).category).toBe("abort");
      expect((err as AbortError).retryable).toBe(false);
    }
  });
});

describe("WorkflowEngine abort signal", () => {
  function createMockStore() {
    const runs = new Map<string, any>();
    const stepRuns = new Map<string, any[]>();
    const events: any[] = [];
    let stepRunId = 0;

    return {
      createRun(data: any) {
        const id = `run-${crypto.randomUUID().slice(0, 8)}`;
        const run = { id, ...data };
        runs.set(id, run);
        stepRuns.set(id, []);
        return run;
      },
      getRun(id: string) { return runs.get(id) ?? null; },
      createStepRun(data: any) {
        const id = `sr-${++stepRunId}`;
        const sr = { id, ...data };
        const list = stepRuns.get(data.run_id) ?? [];
        list.push(sr);
        stepRuns.set(data.run_id, list);
        return sr;
      },
      getStepRunsForRun(runId: string) { return stepRuns.get(runId) ?? []; },
      getStepRunByStepId(runId: string, stepId: string) {
        return (stepRuns.get(runId) ?? []).find((sr: any) => sr.step_id === stepId);
      },
      updateStepRun(id: string, data: any) {
        for (const [, list] of stepRuns) {
          const sr = list.find((s: any) => s.id === id);
          if (sr) Object.assign(sr, data);
        }
      },
      updateRunStatus(id: string, status: string, completedAt?: string) {
        const run = runs.get(id);
        if (run) { run.status = status; if (completedAt) run.completed_at = completedAt; }
      },
      addEvent(data: any) { events.push(data); },
      events,
    };
  }

  test("triggerWorkflow respects abort signal before step creation", async () => {
    const { WorkflowEngine } = await import("../src/services/workflow-engine");
    const store = createMockStore();
    const engine = new WorkflowEngine(store as any, undefined, {});

    const ac = new AbortController();
    ac.abort(); // Pre-aborted

    const definition = {
      name: "test-workflow",
      version: 1,
      on_failure: "stop" as const,
      retro: false,
      steps: [
        { id: "step1", type: "task" as const, description: "Do something", assign: "atlas" },
      ],
    };

    await expect(engine.triggerWorkflow(definition, "test context", ac.signal))
      .rejects.toThrow(AbortError);
  });

  test("triggerWorkflow cancels mid-step when signal aborts", async () => {
    const { WorkflowEngine } = await import("../src/services/workflow-engine");
    const store = createMockStore();
    const engine = new WorkflowEngine(store as any, undefined, {});

    const ac = new AbortController();

    // Override createStepRun to abort after first step
    const originalCreate = store.createStepRun.bind(store);
    let callCount = 0;
    store.createStepRun = (data: any) => {
      callCount++;
      if (callCount >= 2) ac.abort();
      return originalCreate(data);
    };

    const definition = {
      name: "multi-step",
      version: 1,
      on_failure: "stop" as const,
      retro: false,
      steps: [
        { id: "s1", type: "task" as const, description: "First", assign: "atlas" },
        { id: "s2", type: "task" as const, description: "Second", assign: "scout" },
        { id: "s3", type: "task" as const, description: "Third", assign: "atlas" },
      ],
    };

    await expect(engine.triggerWorkflow(definition, "test", ac.signal))
      .rejects.toThrow(AbortError);
  });

  test("scheduleReadySteps checks signal on each iteration", async () => {
    const { WorkflowEngine } = await import("../src/services/workflow-engine");
    const store = createMockStore();
    const engine = new WorkflowEngine(store as any, undefined, {});

    // Set up a run with pending steps
    const run = store.createRun({ workflow_name: "test", status: "running" });
    store.createStepRun({ run_id: run.id, step_id: "s1", status: "pending", attempt: 1 });
    store.createStepRun({ run_id: run.id, step_id: "s2", status: "pending", attempt: 1 });

    const ac = new AbortController();
    ac.abort();

    const definition = {
      name: "test",
      version: 1,
      on_failure: "stop" as const,
      retro: false,
      steps: [
        { id: "s1", type: "task" as const, description: "A", assign: "atlas" },
        { id: "s2", type: "task" as const, description: "B", assign: "scout" },
      ],
    };

    await expect(engine.scheduleReadySteps(run.id, definition, ac.signal))
      .rejects.toThrow(AbortError);
  });
});

describe("collectFromAccounts abort signal", () => {
  test("rejects immediately if signal pre-aborted", async () => {
    const { collectFromAccounts } = await import("../src/services/council-framework");
    const ac = new AbortController();
    ac.abort();

    await expect(
      collectFromAccounts(["atlas", "scout"], async () => "ok", ac.signal),
    ).rejects.toThrow(AbortError);
  });

  test("completes normally without signal", async () => {
    const { collectFromAccounts } = await import("../src/services/council-framework");
    const results = await collectFromAccounts(
      ["atlas", "scout"],
      async (name) => `result-${name}`,
    );
    expect(results).toEqual(["result-atlas", "result-scout"]);
  });
});

describe("LLMCaller abort signal wiring", () => {
  test("createAccountCaller rejects on pre-aborted signal", async () => {
    const { createAccountCaller } = await import("../src/services/council-framework");
    const caller = createAccountCaller([
      { name: "atlas", configDir: "~/.claude", provider: "codex-cli", color: "#000", label: "Atlas" },
    ]);

    const ac = new AbortController();
    ac.abort();

    await expect(caller("atlas", "system", "user", ac.signal))
      .rejects.toThrow(AbortError);
  });

  test("createAccountCaller throws for unknown account regardless of signal", async () => {
    const { createAccountCaller } = await import("../src/services/council-framework");
    const caller = createAccountCaller([]);

    await expect(caller("nonexistent", "system", "user"))
      .rejects.toThrow("Account not found: nonexistent");
  });
});
