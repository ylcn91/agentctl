import type { WorkflowStore } from "./workflow-store";
import type { ActivityStore } from "./activity-store";
import type { WorkflowDefinition } from "./workflow-parser";
import { validateDAG } from "./workflow-parser";
import type { RetroEngine } from "./retro-engine";
import type { EventBus } from "./event-bus";
import { throwIfAborted } from "./errors";
import { schedulePendingSteps } from "./workflow-step-scheduler";

export class WorkflowEngine {
  retroEngine?: RetroEngine;
  eventBus?: EventBus;

  constructor(
    private store: WorkflowStore,
    private activityStore: ActivityStore | undefined,
    private daemonState: any,
  ) {}

  async triggerWorkflow(definition: WorkflowDefinition, context: string, signal?: AbortSignal): Promise<string> {
    validateDAG(definition.steps);
    const now = new Date().toISOString();

    const run = this.store.createRun({
      workflow_name: definition.name,
      status: "running",
      trigger_context: context,
      started_at: now,
      completed_at: null,
      retro_id: null,
    });

    for (const step of definition.steps) {
      throwIfAborted(signal);
      this.store.createStepRun({
        run_id: run.id, step_id: step.id, status: "pending",
        assigned_to: null, task_id: null, handoff_id: null,
        started_at: null, completed_at: null, attempt: 1, result: null,
      });
    }

    this.activityStore?.emit({
      type: "workflow_started", timestamp: now, account: "system",
      workflowRunId: run.id,
      metadata: { workflowName: definition.name, context },
    });
    this.store.addEvent({
      run_id: run.id, step_id: null, type: "workflow_started",
      detail: JSON.stringify({ name: definition.name }), timestamp: now,
    });

    this.eventBus?.emit({
      type: "WORKFLOW_STARTED", runId: run.id,
      workflowName: definition.name, stepCount: definition.steps.length,
    });

    await this.scheduleReadySteps(run.id, definition, signal);
    return run.id;
  }

  async scheduleReadySteps(runId: string, definition?: WorkflowDefinition, signal?: AbortSignal): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) return;

    const result = await schedulePendingSteps(
      this.store, runId, definition, this.daemonState, signal,
    );

    for (const a of result.assigned) {
      this.activityStore?.emit({
        type: "workflow_step_completed", timestamp: new Date().toISOString(),
        account: a.assignee, workflowRunId: runId,
        metadata: { stepId: a.stepId, status: "assigned", assignee: a.assignee },
      });
      this.eventBus?.emit({
        type: "WORKFLOW_STEP_STARTED", runId, stepId: a.stepId,
        assignee: a.assignee, workflowName: run.workflow_name,
      });
    }

    if (result.allTerminal) {
      await this.completeWorkflow(runId, definition);
    }
  }

  async onStepCompleted(
    runId: string, stepId: string,
    result: "accepted" | "rejected" | "failed",
    definition: WorkflowDefinition, signal?: AbortSignal,
  ): Promise<void> {
    const stepRun = this.store.getStepRunByStepId(runId, stepId);
    if (!stepRun) throw new Error(`Step run not found: step '${stepId}' in run '${runId}'`);
    const now = new Date().toISOString();

    this.store.updateStepRun(stepRun.id, { status: "completed", result, completed_at: now });

    this.activityStore?.emit({
      type: "workflow_step_completed", timestamp: now,
      account: stepRun.assigned_to ?? "system", workflowRunId: runId,
      metadata: { stepId, result },
    });
    this.store.addEvent({
      run_id: runId, step_id: stepId, type: "step_completed",
      detail: JSON.stringify({ result }), timestamp: now,
    });

    const durationMs = stepRun.started_at
      ? new Date(now).getTime() - new Date(stepRun.started_at).getTime() : 0;
    this.eventBus?.emit({
      type: "WORKFLOW_STEP_COMPLETED", runId, stepId, result, durationMs,
    });

    await this.scheduleReadySteps(runId, definition, signal);
  }

  async onStepFailed(
    runId: string, stepId: string, error: string,
    definition: WorkflowDefinition, signal?: AbortSignal,
  ): Promise<void> {
    const stepRun = this.store.getStepRunByStepId(runId, stepId);
    if (!stepRun) throw new Error(`Step run not found: step '${stepId}' in run '${runId}'`);
    const now = new Date().toISOString();
    const maxRetries = definition.max_retries ?? 0;
    const willRetry = stepRun.attempt <= maxRetries;

    this.eventBus?.emit({
      type: "WORKFLOW_STEP_FAILED", runId, stepId, error: error.slice(0, 300),
      attempt: stepRun.attempt, willRetry,
    });

    if (willRetry) {
      this.store.updateStepRun(stepRun.id, {
        status: "pending", attempt: stepRun.attempt + 1,
        completed_at: null, started_at: null, assigned_to: null, result: null,
      });
      this.store.addEvent({
        run_id: runId, step_id: stepId, type: "step_retried",
        detail: JSON.stringify({ attempt: stepRun.attempt + 1, error }), timestamp: now,
      });
      await this.scheduleReadySteps(runId, definition, signal);
      return;
    }

    this.store.updateStepRun(stepRun.id, { status: "failed", result: error, completed_at: now });
    this.store.addEvent({
      run_id: runId, step_id: stepId, type: "step_failed",
      detail: JSON.stringify({ error }), timestamp: now,
    });

    if (definition.on_failure === "abort") {
      const allStepRuns = this.store.getStepRunsForRun(runId);
      for (const sr of allStepRuns) {
        if (sr.status === "pending" || sr.status === "assigned") {
          this.store.updateStepRun(sr.id, { status: "skipped", completed_at: now, result: "aborted_due_to_failure" });
        }
      }
      this.store.updateRunStatus(runId, "failed", now);
      this.store.addEvent({
        run_id: runId, step_id: null, type: "workflow_aborted",
        detail: JSON.stringify({ reason: `Step '${stepId}' failed: ${error}` }), timestamp: now,
      });
      this.eventBus?.emit({
        type: "WORKFLOW_COMPLETED", runId, workflowName: this.store.getRun(runId)?.workflow_name ?? "",
        durationMs: 0, status: "failed",
      });
    } else {
      this.store.addEvent({
        run_id: runId, step_id: stepId, type: "step_failure_notified",
        detail: JSON.stringify({ error }), timestamp: now,
      });
      await this.scheduleReadySteps(runId, definition, signal);
    }
  }

  async cancelWorkflow(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);
    const now = new Date().toISOString();
    const stepRuns = this.store.getStepRunsForRun(runId);

    for (const sr of stepRuns) {
      if (sr.status === "pending" || sr.status === "assigned") {
        this.store.updateStepRun(sr.id, { status: "skipped", completed_at: now, result: "cancelled" });
      }
    }

    this.store.updateRunStatus(runId, "cancelled", now);
    this.store.addEvent({ run_id: runId, step_id: null, type: "workflow_cancelled", detail: null, timestamp: now });
    this.eventBus?.emit({ type: "WORKFLOW_CANCELLED", runId });
  }

  private async completeWorkflow(runId: string, definition?: WorkflowDefinition): Promise<void> {
    const now = new Date().toISOString();
    const run = this.store.getRun(runId);
    this.store.updateRunStatus(runId, "completed", now);

    this.activityStore?.emit({
      type: "workflow_completed", timestamp: now, account: "system",
      workflowRunId: runId, metadata: {},
    });
    this.store.addEvent({ run_id: runId, step_id: null, type: "workflow_completed", detail: null, timestamp: now });

    const startedAt = run?.started_at;
    const durationMs = startedAt ? new Date(now).getTime() - new Date(startedAt).getTime() : 0;
    this.eventBus?.emit({
      type: "WORKFLOW_COMPLETED", runId, workflowName: run?.workflow_name ?? "",
      durationMs, status: "completed",
    });

    if (definition?.retro && this.retroEngine) {
      const stepRuns = this.store.getStepRunsForRun(runId);
      const participants = [...new Set(stepRuns.map(s => s.assigned_to).filter(Boolean))] as string[];
      if (participants.length > 0) {
        this.store.updateRunStatus(runId, "retro_in_progress");
        this.retroEngine.startRetro(runId, participants);
      }
    }
  }
}
