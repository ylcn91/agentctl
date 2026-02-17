import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { loadTasks, saveTasks, updateTaskStatus, rejectTask, acceptTask, submitForReview, type TaskStatus } from "../../services/tasks";
import { createReceipt } from "../../services/verification-receipts";
import { checkCognitiveFrictionGate, runAutoAcceptance } from "./acceptance-handler";

const VALID_TASK_STATUSES = new Set<string>(["todo", "in_progress", "ready_for_review", "accepted", "rejected"]);

export function registerTaskHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, features, safeWrite, reply, getAccountName } = ctx;

  return {
    update_task_status: async (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      try {
        if (typeof msg.taskId !== "string" || !msg.taskId) {
          safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" }));
          return;
        }
        if (!VALID_TASK_STATUSES.has(msg.status)) {
          safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: status" }));
          return;
        }
        let board = await loadTasks();
        const status = msg.status as TaskStatus;

        if (status === "rejected") {
          if (!msg.reason) { safeWrite(socket, reply(msg, { type: "error", error: "Reason is required when rejecting" })); return; }
          board = rejectTask(board, msg.taskId, msg.reason);
        } else if (status === "accepted") {
          board = acceptTask(board, msg.taskId);
        } else if (status === "ready_for_review" && (msg.workspacePath || msg.branch)) {
          board = submitForReview(board, msg.taskId, { workspacePath: msg.workspacePath ?? "", branch: msg.branch ?? "", workspaceId: msg.workspaceId });
        } else {
          board = updateTaskStatus(board, msg.taskId, status);
        }

        await saveTasks(board);
        const task = board.tasks.find((t) => t.id === msg.taskId);

        if (status === "in_progress") {
          state.eventBus.emit({ type: "TASK_STARTED", taskId: msg.taskId, agent: accountName });
        } else if (status === "ready_for_review") {
          state.eventBus.emit({ type: "CHECKPOINT_REACHED", taskId: msg.taskId, agent: accountName, percent: 100, step: "ready_for_review" });
        } else if (status === "accepted") {
          state.eventBus.emit({ type: "TASK_COMPLETED", taskId: msg.taskId, agent: task?.assignee ?? accountName, result: "success" });
          recordTrustOutcome(state, task, accountName, "completed", "task_accepted");
          emitVerificationReceipt(state, msg, task, accountName, "accepted");
        } else if (status === "rejected") {
          state.eventBus.emit({ type: "TASK_COMPLETED", taskId: msg.taskId, agent: task?.assignee ?? accountName, result: "failure" });
          recordTrustOutcome(state, task, accountName, "rejected", "task_rejected");
          emitVerificationReceipt(state, msg, task, accountName, "rejected");
        }

        if (features?.githubIntegration) {
          (async () => { try { const { onTaskStatusChanged } = await import("../../services/integration-hooks"); await onTaskStatusChanged(msg.taskId, status, { reason: msg.reason }); } catch (e: any) { console.error("[github]", e.message); } })();
        }

        if (status === "ready_for_review" && features?.reviewBundles && task?.workspaceContext) {
          (async () => { try { const { generateReviewBundle } = await import("../../services/review-bundle"); const { saveBundle } = await import("../../services/review-bundle-store"); const bundle = await generateReviewBundle({ taskId: msg.taskId, workDir: task.workspaceContext!.workspacePath, branch: task.workspaceContext!.branch }); await saveBundle(bundle); } catch (e: any) { console.error("[review-bundle]", e.message); } })();
        }

        if (status === "ready_for_review" && features?.autoAcceptance && task) {
          const blocked = await checkCognitiveFrictionGate(ctx, socket, msg, task, accountName);
          if (blocked) return;
          safeWrite(socket, reply(msg, { type: "result", task, acceptance: "running" }));
          runAutoAcceptance(ctx, msg, task, accountName);
        } else {
          safeWrite(socket, reply(msg, { type: "result", task }));
        }
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    report_progress: (socket: Socket, msg: any) => {
      const accountName = getAccountName(socket);
      if (typeof msg.taskId !== "string" || !msg.taskId) { safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: taskId" })); return; }
      if (typeof msg.percent !== "number" || msg.percent < 0 || msg.percent > 100) { safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: percent" })); return; }
      const report = state.progressTracker.report({
        taskId: msg.taskId, agent: msg.agent ?? accountName, percent: msg.percent,
        currentStep: msg.currentStep ?? "", blockers: msg.blockers,
        estimatedRemainingMinutes: msg.estimatedRemainingMinutes, artifactsProduced: msg.artifactsProduced,
      });
      state.eventBus.emit({ type: "PROGRESS_UPDATE", taskId: msg.taskId, agent: msg.agent ?? accountName, data: { percent: msg.percent, currentStep: msg.currentStep ?? "" } });
      if (msg.percent === 100) {
        state.eventBus.emit({ type: "CHECKPOINT_REACHED", taskId: msg.taskId, agent: msg.agent ?? accountName, percent: 100, step: msg.currentStep ?? "complete" });
      }
      safeWrite(socket, reply(msg, { type: "result", report }));
    },

    adaptive_sla_check: async (socket: Socket, msg: any) => {
      if (!features?.slaEngine) { safeWrite(socket, reply(msg, { type: "error", error: "SLA engine not enabled" })); return; }
      try {
        const { AdaptiveCoordinator } = await import("../../services/adaptive-coordinator");
        const board = await loadTasks();
        const taskStates = board.tasks
          .filter((t) => t.status === "in_progress")
          .map((t) => {
            const startEvent = t.events?.find((e: any) => e.to === "in_progress");
            const latest = state.progressTracker.getLatest(t.id);
            return { taskId: t.id, status: t.status, assignee: t.assignee ?? "", criticality: t.priority as any, startedAt: startEvent?.timestamp, lastProgressReport: latest ? { percent: latest.percent, timestamp: latest.timestamp } : undefined, reassignmentCount: 0 };
          });
        const coordinator = new AdaptiveCoordinator(msg.config);
        const actions = coordinator.evaluate(taskStates);
        safeWrite(socket, reply(msg, { type: "result", actions }));
      } catch (err: any) { safeWrite(socket, reply(msg, { type: "error", error: err.message })); }
    },

    get_trust: (socket: Socket, msg: any) => {
      if (!features?.trust) { safeWrite(socket, reply(msg, { type: "error", error: "Trust feature not enabled" })); return; }
      if (!state.trustStore) { safeWrite(socket, reply(msg, { type: "error", error: "Trust store not initialized" })); return; }
      if (msg.account) {
        safeWrite(socket, reply(msg, { type: "result", trust: state.trustStore.get(msg.account) }));
      } else {
        safeWrite(socket, reply(msg, { type: "result", trust: state.trustStore.getAll() }));
      }
    },

    reinstate_agent: (socket: Socket, msg: any) => {
      if (!state.circuitBreaker) { safeWrite(socket, reply(msg, { type: "error", error: "Circuit breaker not enabled" })); return; }
      if (typeof msg.account !== "string" || !msg.account) { safeWrite(socket, reply(msg, { type: "error", error: "Invalid field: account" })); return; }
      safeWrite(socket, reply(msg, { type: "result", reinstated: state.circuitBreaker.reinstateAgent(msg.account) }));
    },

    check_circuit_breaker: (socket: Socket, msg: any) => {
      if (!state.circuitBreaker) { safeWrite(socket, reply(msg, { type: "error", error: "Circuit breaker not enabled" })); return; }
      if (msg.account) {
        const record = state.circuitBreaker.getQuarantineRecord(msg.account);
        safeWrite(socket, reply(msg, { type: "result", quarantined: state.circuitBreaker.isQuarantined(msg.account), record }));
      } else {
        safeWrite(socket, reply(msg, { type: "result", quarantined: state.circuitBreaker.getAllQuarantined() }));
      }
    },
  };
}

function recordTrustOutcome(state: any, task: any, _accountName: string, outcome: string, reason: string) {
  if (!state.trustStore || !task?.assignee) return;
  const createdEvent = task.events.find((e: any) => e.type === "status_changed" && e.to === "in_progress");
  const durationMinutes = createdEvent ? (Date.now() - new Date(createdEvent.timestamp).getTime()) / 60000 : undefined;
  const oldScore = state.trustStore.get(task.assignee)?.trustScore ?? 50;
  state.trustStore.recordOutcome(task.assignee, outcome, durationMinutes);
  const newScore = state.trustStore.get(task.assignee)?.trustScore ?? 50;
  if (newScore !== oldScore) {
    state.eventBus.emit({ type: "TRUST_UPDATE", agent: task.assignee, delta: newScore - oldScore, reason });
  }
}

function emitVerificationReceipt(state: any, msg: any, task: any, accountName: string, verdict: "accepted" | "rejected") {
  if (!task) return;
  try {
    const assignee = task.assignee ?? accountName;
    const candidates = assignee !== accountName
      ? [...state.getHandoffs(assignee), ...state.getHandoffs(accountName)]
      : state.getHandoffs(accountName);
    const handoff = candidates.find((h: any) => h.id === msg.taskId);
    const specPayload = handoff ? handoff.content : msg.taskId;
    const receipt = createReceipt({ taskId: msg.taskId, delegator: accountName, delegatee: assignee, specPayload, verdict, method: "human-review" });
    state.eventBus.emit({ type: "TASK_VERIFIED", taskId: msg.taskId, verifier: accountName, passed: verdict === "accepted", receipt });
    state.activityStore?.emit({ type: "task_verified", timestamp: receipt.timestamp, account: accountName, taskId: msg.taskId, metadata: { receipt } });
  } catch (e: any) { console.error("[receipt]", e.message); }
}
