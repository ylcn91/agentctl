import { test, expect, beforeEach, afterEach } from "bun:test";
import { WorkflowStore } from "../src/services/workflow-store";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let store: WorkflowStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "workflow-store-test-"));
  store = new WorkflowStore(join(tmpDir, "workflow.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("create and get run", () => {
  const run = store.createRun({
    workflow_name: "deploy",
    status: "running",
    trigger_context: "feature-x",
    started_at: new Date().toISOString(),
    completed_at: null,
    retro_id: null,
  });
  expect(run.id).toBeDefined();
  expect(run.workflow_name).toBe("deploy");

  const fetched = store.getRun(run.id);
  expect(fetched).not.toBeNull();
  expect(fetched!.workflow_name).toBe("deploy");
  expect(fetched!.status).toBe("running");
});

test("update run status", () => {
  const run = store.createRun({
    workflow_name: "test",
    status: "running",
    trigger_context: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    retro_id: null,
  });

  const now = new Date().toISOString();
  store.updateRunStatus(run.id, "completed", now);

  const updated = store.getRun(run.id);
  expect(updated!.status).toBe("completed");
  expect(updated!.completed_at).toBe(now);
});

test("create and get step runs", () => {
  const run = store.createRun({
    workflow_name: "test",
    status: "running",
    trigger_context: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    retro_id: null,
  });

  const step = store.createStepRun({
    run_id: run.id,
    step_id: "implement",
    status: "pending",
    assigned_to: null,
    task_id: null,
    handoff_id: null,
    started_at: null,
    completed_at: null,
    attempt: 1,
    result: null,
  });

  expect(step.id).toBeDefined();
  expect(step.step_id).toBe("implement");

  const fetched = store.getStepRun(step.id);
  expect(fetched).not.toBeNull();
  expect(fetched!.step_id).toBe("implement");
});

test("update step run with result", () => {
  const run = store.createRun({
    workflow_name: "test",
    status: "running",
    trigger_context: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    retro_id: null,
  });

  const step = store.createStepRun({
    run_id: run.id,
    step_id: "review",
    status: "assigned",
    assigned_to: "reviewer",
    task_id: null,
    handoff_id: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    attempt: 1,
    result: null,
  });

  const now = new Date().toISOString();
  store.updateStepRun(step.id, {
    status: "completed",
    result: "accepted",
    completed_at: now,
  });

  const updated = store.getStepRun(step.id);
  expect(updated!.status).toBe("completed");
  expect(updated!.result).toBe("accepted");
  expect(updated!.completed_at).toBe(now);
});

test("list runs by workflow name", () => {
  store.createRun({ workflow_name: "deploy", status: "completed", trigger_context: null, started_at: new Date().toISOString(), completed_at: null, retro_id: null });
  store.createRun({ workflow_name: "deploy", status: "running", trigger_context: null, started_at: new Date().toISOString(), completed_at: null, retro_id: null });
  store.createRun({ workflow_name: "test", status: "running", trigger_context: null, started_at: new Date().toISOString(), completed_at: null, retro_id: null });

  const deployRuns = store.listRuns("deploy");
  expect(deployRuns).toHaveLength(2);

  const allRuns = store.listRuns();
  expect(allRuns).toHaveLength(3);
});

test("get step runs for run", () => {
  const run = store.createRun({
    workflow_name: "test",
    status: "running",
    trigger_context: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    retro_id: null,
  });

  store.createStepRun({ run_id: run.id, step_id: "a", status: "pending", assigned_to: null, task_id: null, handoff_id: null, started_at: null, completed_at: null, attempt: 1, result: null });
  store.createStepRun({ run_id: run.id, step_id: "b", status: "pending", assigned_to: null, task_id: null, handoff_id: null, started_at: null, completed_at: null, attempt: 1, result: null });

  const steps = store.getStepRunsForRun(run.id);
  expect(steps).toHaveLength(2);
});

test("add and get events", () => {
  const run = store.createRun({
    workflow_name: "test",
    status: "running",
    trigger_context: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    retro_id: null,
  });

  store.addEvent({ run_id: run.id, step_id: null, type: "workflow_started", detail: null, timestamp: new Date().toISOString() });
  store.addEvent({ run_id: run.id, step_id: "a", type: "step_assigned", detail: '{"assignee":"auto"}', timestamp: new Date().toISOString() });

  const events = store.getEvents(run.id);
  expect(events).toHaveLength(2);
  expect(events[0].type).toBe("workflow_started");
});

test("getStepRunByStepId", () => {
  const run = store.createRun({
    workflow_name: "test",
    status: "running",
    trigger_context: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    retro_id: null,
  });

  store.createStepRun({ run_id: run.id, step_id: "impl", status: "pending", assigned_to: null, task_id: null, handoff_id: null, started_at: null, completed_at: null, attempt: 1, result: null });

  const found = store.getStepRunByStepId(run.id, "impl");
  expect(found).not.toBeNull();
  expect(found!.step_id).toBe("impl");

  const notFound = store.getStepRunByStepId(run.id, "nonexistent");
  expect(notFound).toBeNull();
});

test("getRun returns null for unknown ID", () => {
  expect(store.getRun("nonexistent")).toBeNull();
});
