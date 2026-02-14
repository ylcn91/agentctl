// F-05: Adaptive SLA with Graduated Responses
// Paper ref: Section 4.3 (Adaptive Coordination Cycle) — graduated response ladder

export type ResponseAction =
  | { action: "ping"; taskId: string; agent: string; message: string }
  | { action: "suggest_reassign"; taskId: string; currentAgent: string; reason: string }
  | { action: "auto_reassign"; taskId: string; from: string; to: string; reason: string }
  | { action: "quarantine_agent"; agent: string; reason: string }
  | { action: "escalate_human"; taskId: string; reason: string }
  | { action: "proactive_warning"; taskId: string; agent: string; message: string };

export interface TaskState {
  taskId: string;
  status: string;
  assignee: string;
  criticality?: "low" | "medium" | "high" | "critical";
  startedAt?: string;
  lastProgressReport?: { percent: number; timestamp: string };
  estimatedDurationMinutes?: number;
  reassignmentCount: number;
  consecutiveRejectionsBy?: Map<string, number>;
}

export interface AdaptiveCoordinatorConfig {
  pingAfterMinutes: number;
  suggestReassignAfterMinutes: number;
  autoReassignCriticalAfterMinutes: number;
  unresponsiveThresholdMinutes: number;
  maxReassignments: number;
  cooldownMinutes: number;
  consecutiveRejectionsForPenalty: number;
  behindScheduleThresholdPercent: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveCoordinatorConfig = {
  pingAfterMinutes: 30,
  suggestReassignAfterMinutes: 60,
  autoReassignCriticalAfterMinutes: 60,
  unresponsiveThresholdMinutes: 10,
  maxReassignments: 3,
  cooldownMinutes: 10,
  consecutiveRejectionsForPenalty: 2,
  behindScheduleThresholdPercent: 20,
};

export class AdaptiveCoordinator {
  private config: AdaptiveCoordinatorConfig;
  private lastReassignment = new Map<string, number>();

  constructor(config?: Partial<AdaptiveCoordinatorConfig>) {
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
  }

  evaluate(tasks: TaskState[], now: Date = new Date()): ResponseAction[] {
    const actions: ResponseAction[] = [];
    const nowMs = now.getTime();

    for (const task of tasks) {
      // Check consecutive rejections for quarantine
      if (task.consecutiveRejectionsBy) {
        for (const [agent, count] of task.consecutiveRejectionsBy) {
          if (count >= this.config.consecutiveRejectionsForPenalty) {
            actions.push({
              action: "quarantine_agent",
              agent,
              reason: `${count} consecutive rejections on task ${task.taskId}`,
            });
          }
        }
      }

      if (task.status !== "in_progress") continue;

      const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : null;
      if (!startedAt) continue;

      const elapsedMs = nowMs - startedAt;
      const elapsedMinutes = elapsedMs / 60_000;

      // Behind schedule detection
      if (
        task.lastProgressReport &&
        task.estimatedDurationMinutes &&
        task.estimatedDurationMinutes > 0
      ) {
        const expectedPercent = Math.min(
          100,
          (elapsedMinutes / task.estimatedDurationMinutes) * 100,
        );
        if (
          task.lastProgressReport.percent <
          expectedPercent - this.config.behindScheduleThresholdPercent
        ) {
          actions.push({
            action: "proactive_warning",
            taskId: task.taskId,
            agent: task.assignee,
            message: `Task is behind schedule: ${task.lastProgressReport.percent}% complete vs ${Math.round(expectedPercent)}% expected`,
          });
        }
      }

      // Unresponsive agent detection
      if (task.lastProgressReport) {
        const reportAge =
          nowMs - new Date(task.lastProgressReport.timestamp).getTime();
        if (reportAge > this.config.unresponsiveThresholdMinutes * 60_000) {
          actions.push({
            action: "quarantine_agent",
            agent: task.assignee,
            reason: `No progress report for ${Math.round(reportAge / 60_000)} minutes on task ${task.taskId}`,
          });
        }
      }

      // Graduated response ladder
      if (task.reassignmentCount >= this.config.maxReassignments) {
        if (elapsedMinutes > this.config.suggestReassignAfterMinutes) {
          actions.push({
            action: "escalate_human",
            taskId: task.taskId,
            reason: `Max reassignments (${this.config.maxReassignments}) reached and task still stale after ${Math.round(elapsedMinutes)} minutes`,
          });
        }
      } else if (
        elapsedMinutes > this.config.autoReassignCriticalAfterMinutes &&
        task.criticality === "critical" &&
        this.canReassign(task.taskId, now)
      ) {
        actions.push({
          action: "auto_reassign",
          taskId: task.taskId,
          from: task.assignee,
          to: "",
          reason: `Critical task in progress for ${Math.round(elapsedMinutes)} minutes`,
        });
      } else if (elapsedMinutes > this.config.suggestReassignAfterMinutes) {
        actions.push({
          action: "suggest_reassign",
          taskId: task.taskId,
          currentAgent: task.assignee,
          reason: `Task in progress for ${Math.round(elapsedMinutes)} minutes without completion`,
        });
      } else if (elapsedMinutes > this.config.pingAfterMinutes) {
        actions.push({
          action: "ping",
          taskId: task.taskId,
          agent: task.assignee,
          message: `Task has been in progress for ${Math.round(elapsedMinutes)} minutes. Please report status.`,
        });
      }
    }

    return actions;
  }

  canReassign(taskId: string, now: Date = new Date()): boolean {
    const lastTime = this.lastReassignment.get(taskId);
    if (lastTime === undefined) return true;
    return now.getTime() - lastTime >= this.config.cooldownMinutes * 60_000;
  }

  recordReassignment(taskId: string): void {
    this.lastReassignment.set(taskId, Date.now());
  }
}
