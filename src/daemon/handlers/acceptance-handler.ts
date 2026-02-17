
import type { Socket } from "net";
import type { HandlerContext } from "../handler-types";
import { loadTasks, saveTasks, acceptTask, rejectTask } from "../../services/tasks";
import { runAcceptanceSuite, runAcceptanceSuiteStreaming } from "../../services/acceptance-runner";
import { createReceipt } from "../../services/verification-receipts";

export async function checkCognitiveFrictionGate(
  ctx: HandlerContext, socket: Socket, msg: any,
  task: any, accountName: string,
): Promise<boolean> {
  const { state, features, safeWrite, reply } = ctx;
  if (!features?.cognitiveFriction) return false;

  try {
    const assignee = task.assignee ?? accountName;
    const candidates = assignee !== accountName
      ? [...state.getHandoffs(assignee), ...state.getHandoffs(accountName)]
      : state.getHandoffs(accountName);
    const handoff = candidates.find((h: any) => {
      if (h.id === msg.taskId) return true;
      const ctx2 = h.context ?? {};
      return ctx2.branch === msg.branch || ctx2.projectDir === msg.workspacePath;
    });
    if (!handoff) return false;

    let frictionPayload: any;
    try { frictionPayload = JSON.parse(handoff.content); } catch { return false; }

    const { checkCognitiveFriction } = await import("../../services/cognitive-friction");
    const friction = checkCognitiveFriction(frictionPayload);
    if (friction.requiresHumanReview) {
      state.activityStore?.emit({
        type: "cognitive_friction_triggered",
        timestamp: new Date().toISOString(),
        account: accountName,
        metadata: { taskId: msg.taskId, frictionLevel: friction.frictionLevel, reason: friction.reason },
      });
      safeWrite(socket, reply(msg, {
        type: "result", task, acceptance: "blocked",
        reason: friction.reason, frictionLevel: friction.frictionLevel,
      }));
      return true;
    }
  } catch (e: any) {
    console.error("[cognitive-friction]", e.message);
  }
  return false;
}

export function runAutoAcceptance(
  ctx: HandlerContext, msg: any, task: any, accountName: string,
): void {
  const { state, features } = ctx;

  (async () => {
    try {
      const handoffs = state.getHandoffs(accountName);
      const handoff = handoffs.find((h: any) => {
        const ctx2 = h.context ?? {};
        return ctx2.branch === msg.branch || ctx2.projectDir === msg.workspacePath;
      });
      if (!handoff) return;
      let payload: any;
      try { payload = JSON.parse(handoff.content); } catch { return; }
      const cmds: string[] = payload.run_commands ?? [];
      if (cmds.length === 0) return;
      const workDir = task.workspaceContext?.workspacePath ?? msg.workspacePath;
      if (!workDir) return;

      const result = features?.streaming
        ? await runAcceptanceSuiteStreaming(cmds, workDir, (line, stream) => {
            state.eventBus.emit({ type: "TDD_TEST_OUTPUT", testFile: msg.taskId, line, stream });
          })
        : await runAcceptanceSuite(cmds, workDir);

      let updatedBoard = await loadTasks();
      if (result.passed) {
        updatedBoard = acceptTask(updatedBoard, msg.taskId);
      } else {
        updatedBoard = rejectTask(updatedBoard, msg.taskId, result.summary);
      }
      await saveTasks(updatedBoard);

      try {
        const receipt = createReceipt({
          taskId: msg.taskId, delegator: handoff.from,
          delegatee: task.assignee ?? accountName, specPayload: handoff.content,
          verdict: result.passed ? "accepted" : "rejected", method: "auto-acceptance",
        });
        state.eventBus.emit({ type: "TASK_VERIFIED", taskId: msg.taskId, verifier: "auto-acceptance", passed: result.passed, receipt });
        state.activityStore?.emit({ type: "task_verified", timestamp: receipt.timestamp, account: "auto-acceptance", taskId: msg.taskId, metadata: { receipt } });
      } catch (e: any) {
        console.error("[receipt]", e.message);
        state.eventBus.emit({ type: "TASK_VERIFIED", taskId: msg.taskId, verifier: "auto-acceptance", passed: result.passed });
      }

      if (state.trustStore && task.assignee) {
        const createdEvent = task.events.find((e: any) => e.type === "status_changed" && e.to === "in_progress");
        const durationMinutes = createdEvent ? (Date.now() - new Date(createdEvent.timestamp).getTime()) / 60000 : undefined;
        const oldRep = state.trustStore.get(task.assignee);
        const oldScore = oldRep?.trustScore ?? 50;
        if (result.passed) {
          state.trustStore.recordOutcome(task.assignee, "completed", durationMinutes);
        } else {
          state.trustStore.recordOutcome(task.assignee, "failed");
        }
        const newRep = state.trustStore.get(task.assignee);
        if (newRep && newRep.trustScore !== oldScore) {
          state.eventBus.emit({
            type: "TRUST_UPDATE", agent: task.assignee,
            delta: newRep.trustScore - oldScore,
            reason: result.passed ? "auto_acceptance_passed" : "auto_acceptance_failed",
          });
        }
      }
    } catch (e: any) { console.error("[accept]", e.message); }
  })();
}
