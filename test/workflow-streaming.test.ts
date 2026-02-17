import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { WorkflowStore } from "../src/services/workflow-store";
import { WorkflowEngine } from "../src/services/workflow-engine";
import { EventBus, type DelegationEvent } from "../src/services/event-bus";
import type { WorkflowDefinition } from "../src/services/workflow-parser";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let store: WorkflowStore;
let engine: WorkflowEngine;
let bus: EventBus;
let tmpDir: string;
let events: Array<DelegationEvent & { id: string; timestamp: string }>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wf-stream-test-"));
  store = new WorkflowStore(join(tmpDir, "workflow.db"));
  engine = new WorkflowEngine(store, undefined, {});
  bus = new EventBus({ maxRecent: 200 });
  engine.eventBus = bus;
  events = [];
  bus.on("*", (e) => events.push(e));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function simpleDef(): WorkflowDefinition {
  return {
    name: "test-wf",
    version: 1,
    steps: [{ id: "s1", title: "Step 1", assign: "agent-1", handoff: { goal: "Do it" } }],
    on_failure: "notify",
    retro: false,
  };
}

function twoDef(): WorkflowDefinition {
  return {
    name: "two-step",
    version: 1,
    steps: [
      { id: "a", title: "A", assign: "agent-1", handoff: { goal: "A" } },
      { id: "b", title: "B", assign: "agent-2", depends_on: ["a"], handoff: { goal: "B" } },
    ],
    on_failure: "notify",
    retro: false,
  };
}

describe("WORKFLOW_STARTED event", () => {
  test("emitted when workflow triggers", async () => {
    await engine.triggerWorkflow(simpleDef(), "ctx");
    const starts = events.filter((e) => e.type === "WORKFLOW_STARTED") as any[];
    expect(starts).toHaveLength(1);
    expect(starts[0].workflowName).toBe("test-wf");
    expect(starts[0].stepCount).toBe(1);
    expect(starts[0].runId).toBeDefined();
  });
});

describe("WORKFLOW_STEP_STARTED event", () => {
  test("emitted for each assigned step", async () => {
    await engine.triggerWorkflow(simpleDef(), "ctx");
    const stepStarts = events.filter((e) => e.type === "WORKFLOW_STEP_STARTED") as any[];
    expect(stepStarts).toHaveLength(1);
    expect(stepStarts[0].stepId).toBe("s1");
    expect(stepStarts[0].assignee).toBe("agent-1");
    expect(stepStarts[0].workflowName).toBe("test-wf");
  });

  test("emitted for newly unblocked steps after completion", async () => {
    const def = twoDef();
    const runId = await engine.triggerWorkflow(def, "");
    events.length = 0;
    await engine.onStepCompleted(runId, "a", "accepted", def);
    const stepStarts = events.filter((e) => e.type === "WORKFLOW_STEP_STARTED") as any[];
    expect(stepStarts).toHaveLength(1);
    expect(stepStarts[0].stepId).toBe("b");
    expect(stepStarts[0].assignee).toBe("agent-2");
  });
});

describe("WORKFLOW_STEP_COMPLETED event", () => {
  test("includes duration and result", async () => {
    const def = simpleDef();
    const runId = await engine.triggerWorkflow(def, "");
    events.length = 0;
    await engine.onStepCompleted(runId, "s1", "accepted", def);
    const completed = events.filter((e) => e.type === "WORKFLOW_STEP_COMPLETED") as any[];
    expect(completed).toHaveLength(1);
    expect(completed[0].stepId).toBe("s1");
    expect(completed[0].result).toBe("accepted");
    expect(completed[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("WORKFLOW_STEP_FAILED event", () => {
  test("emitted with willRetry=true when retries available", async () => {
    const def: WorkflowDefinition = {
      name: "retry",
      version: 1,
      steps: [{ id: "flaky", title: "F", assign: "a1", handoff: { goal: "G" } }],
      on_failure: "notify",
      max_retries: 2,
      retro: false,
    };
    const runId = await engine.triggerWorkflow(def, "");
    events.length = 0;
    await engine.onStepFailed(runId, "flaky", "timeout", def);
    const failed = events.filter((e) => e.type === "WORKFLOW_STEP_FAILED") as any[];
    expect(failed).toHaveLength(1);
    expect(failed[0].willRetry).toBe(true);
    expect(failed[0].attempt).toBe(1);
    expect(failed[0].error).toBe("timeout");
  });

  test("emitted with willRetry=false when no retries left", async () => {
    const def: WorkflowDefinition = {
      name: "no-retry",
      version: 1,
      steps: [{ id: "s", title: "S", assign: "a1", handoff: { goal: "G" } }],
      on_failure: "notify",
      retro: false,
    };
    const runId = await engine.triggerWorkflow(def, "");
    events.length = 0;
    await engine.onStepFailed(runId, "s", "crash", def);
    const failed = events.filter((e) => e.type === "WORKFLOW_STEP_FAILED") as any[];
    expect(failed).toHaveLength(1);
    expect(failed[0].willRetry).toBe(false);
  });

  test("error is truncated to 300 chars", async () => {
    const def = simpleDef();
    const runId = await engine.triggerWorkflow(def, "");
    events.length = 0;
    const longError = "x".repeat(500);
    await engine.onStepFailed(runId, "s1", longError, def);
    const failed = events.filter((e) => e.type === "WORKFLOW_STEP_FAILED") as any[];
    expect(failed[0].error.length).toBe(300);
  });
});

describe("WORKFLOW_COMPLETED event", () => {
  test("emitted when all steps done", async () => {
    const def = simpleDef();
    const runId = await engine.triggerWorkflow(def, "");
    events.length = 0;
    await engine.onStepCompleted(runId, "s1", "accepted", def);
    const completed = events.filter((e) => e.type === "WORKFLOW_COMPLETED") as any[];
    expect(completed).toHaveLength(1);
    expect(completed[0].workflowName).toBe("test-wf");
    expect(completed[0].status).toBe("completed");
    expect(completed[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("emitted with status=failed on abort", async () => {
    const def: WorkflowDefinition = {
      name: "abort-wf",
      version: 1,
      steps: [
        { id: "a", title: "A", assign: "a1", handoff: { goal: "G" } },
        { id: "b", title: "B", assign: "a2", depends_on: ["a"], handoff: { goal: "G" } },
      ],
      on_failure: "abort",
      retro: false,
    };
    const runId = await engine.triggerWorkflow(def, "");
    events.length = 0;
    await engine.onStepFailed(runId, "a", "broke", def);
    const completed = events.filter((e) => e.type === "WORKFLOW_COMPLETED") as any[];
    expect(completed).toHaveLength(1);
    expect(completed[0].status).toBe("failed");
  });
});

describe("WORKFLOW_CANCELLED event", () => {
  test("emitted on cancel", async () => {
    const def = simpleDef();
    const runId = await engine.triggerWorkflow(def, "");
    events.length = 0;
    await engine.cancelWorkflow(runId);
    const cancelled = events.filter((e) => e.type === "WORKFLOW_CANCELLED") as any[];
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].runId).toBe(runId);
  });
});

describe("no events without eventBus", () => {
  test("engine works without eventBus set", async () => {
    engine.eventBus = undefined;
    const def = simpleDef();
    const runId = await engine.triggerWorkflow(def, "");
    await engine.onStepCompleted(runId, "s1", "accepted", def);
    expect(events).toHaveLength(0);
  });
});

describe("full lifecycle event sequence", () => {
  test("trigger -> step start -> step complete -> workflow complete", async () => {
    const def = simpleDef();
    const runId = await engine.triggerWorkflow(def, "");
    await engine.onStepCompleted(runId, "s1", "accepted", def);

    const types = events.map((e) => e.type);
    expect(types).toContain("WORKFLOW_STARTED");
    expect(types).toContain("WORKFLOW_STEP_STARTED");
    expect(types).toContain("WORKFLOW_STEP_COMPLETED");
    expect(types).toContain("WORKFLOW_COMPLETED");

    const startIdx = types.indexOf("WORKFLOW_STARTED");
    const stepStartIdx = types.indexOf("WORKFLOW_STEP_STARTED");
    const stepCompleteIdx = types.indexOf("WORKFLOW_STEP_COMPLETED");
    const completeIdx = types.indexOf("WORKFLOW_COMPLETED");
    expect(startIdx).toBeLessThan(stepStartIdx);
    expect(stepStartIdx).toBeLessThan(stepCompleteIdx);
    expect(stepCompleteIdx).toBeLessThan(completeIdx);
  });
});
