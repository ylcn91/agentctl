
import type { WorkflowStore } from "./workflow-store";
import type { WorkflowDefinition } from "./workflow-parser";
import { evaluateCondition, type EvalContext } from "./condition-evaluator";
import { throwIfAborted } from "./errors";

const TERMINAL = new Set(["completed", "failed", "skipped"]);

export interface ScheduleResult {
  assigned: Array<{ stepRunId: string; stepId: string; assignee: string }>;
  skipped: Array<{ stepRunId: string; stepId: string; condition: string }>;
  allTerminal: boolean;
  stepCount: number;
}

function buildContext(
  store: WorkflowStore,
  runId: string,
): { completedIds: Set<string>; conditionCtx: EvalContext } {
  const stepRuns = store.getStepRunsForRun(runId);
  const run = store.getRun(runId);
  const stepContext = new Map<string, { result?: string; duration_ms?: number; assignee?: string }>();
  const completedIds = new Set<string>();

  for (const sr of stepRuns) {
    if (!TERMINAL.has(sr.status)) continue;
    completedIds.add(sr.step_id);
    let durationMs: number | undefined;
    if (sr.started_at && sr.completed_at) {
      durationMs = new Date(sr.completed_at).getTime() - new Date(sr.started_at).getTime();
    }
    stepContext.set(sr.step_id, {
      result: sr.result ?? undefined,
      duration_ms: durationMs,
      assignee: sr.assigned_to ?? undefined,
    });
  }

  return {
    completedIds,
    conditionCtx: { steps: stepContext, trigger: { context: run?.trigger_context ?? "" } },
  };
}

async function resolveAssignee(
  stepDef: WorkflowDefinition["steps"][0],
  daemonState: any,
): Promise<string> {
  let assignee = stepDef.assign;
  if (assignee === "auto" && daemonState?.capabilityStore) {
    try {
      const { rankAccounts } = await import("./account-capabilities");
      const capabilities = daemonState.capabilityStore.getAll();
      const scores = rankAccounts(capabilities, stepDef.skills ?? []);
      if (scores.length > 0) assignee = scores[0].accountName;
    } catch {  }
  }
  return assignee;
}

export async function schedulePendingSteps(
  store: WorkflowStore,
  runId: string,
  definition: WorkflowDefinition | undefined,
  daemonState: any,
  signal?: AbortSignal,
): Promise<ScheduleResult> {
  const stepRuns = store.getStepRunsForRun(runId);
  const { completedIds, conditionCtx } = buildContext(store, runId);
  const stepDefs = definition?.steps;
  const assigned: ScheduleResult["assigned"] = [];
  const skipped: ScheduleResult["skipped"] = [];

  for (const sr of stepRuns) {
    throwIfAborted(signal);
    if (sr.status !== "pending") continue;
    const stepDef = stepDefs?.find((s) => s.id === sr.step_id);
    if (!stepDef) continue;
    const deps = stepDef.depends_on ?? [];
    if (!deps.every((dep) => completedIds.has(dep))) continue;

    if (stepDef.condition) {
      const met = evaluateCondition(stepDef.condition.when, conditionCtx);
      if (!met) {
        const now = new Date().toISOString();
        store.updateStepRun(sr.id, { status: "skipped", completed_at: now, result: "condition_not_met" });
        store.addEvent({ run_id: runId, step_id: sr.step_id, type: "step_skipped", detail: JSON.stringify({ condition: stepDef.condition.when }), timestamp: now });
        skipped.push({ stepRunId: sr.id, stepId: sr.step_id, condition: stepDef.condition.when });
        continue;
      }
    }

    const assignee = await resolveAssignee(stepDef, daemonState);
    const now = new Date().toISOString();
    store.updateStepRun(sr.id, { status: "assigned", assigned_to: assignee, started_at: now });
    store.addEvent({ run_id: runId, step_id: sr.step_id, type: "step_assigned", detail: JSON.stringify({ assignee }), timestamp: now });
    assigned.push({ stepRunId: sr.id, stepId: sr.step_id, assignee });
  }

  if (skipped.length > 0) {
    const pass2 = store.getStepRunsForRun(runId);
    const newCompleted = new Set(pass2.filter((sr) => TERMINAL.has(sr.status)).map((sr) => sr.step_id));
    for (const sr of pass2) {
      if (sr.status !== "pending") continue;
      const stepDef = stepDefs?.find((s) => s.id === sr.step_id);
      if (!stepDef) continue;
      if (!(stepDef.depends_on ?? []).every((dep) => newCompleted.has(dep))) continue;
      const assignee = stepDef.assign;
      const now = new Date().toISOString();
      store.updateStepRun(sr.id, { status: "assigned", assigned_to: assignee, started_at: now });
      store.addEvent({ run_id: runId, step_id: sr.step_id, type: "step_assigned", detail: JSON.stringify({ assignee }), timestamp: now });
      assigned.push({ stepRunId: sr.id, stepId: sr.step_id, assignee });
    }
  }

  const finalRuns = store.getStepRunsForRun(runId);
  const allTerminal = finalRuns.length > 0 && finalRuns.every((sr) => TERMINAL.has(sr.status));

  return { assigned, skipped, allTerminal, stepCount: finalRuns.length };
}
