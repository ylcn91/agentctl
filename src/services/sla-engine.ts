
import type { Task, TaskStatus } from "./tasks";
import type { EntireAdapter, EntireSessionMetrics } from "./entire-adapter";
import type { EventBus } from "./event-bus";
import type { TaskCharacteristics } from "./event-bus";
import {
  type AdaptiveSLAConfig,
  type AdaptiveEscalation,
  type Escalation,
  type SLAConfig,
  DEFAULT_ADAPTIVE_SLA_CONFIG,
  DEFAULT_SLA_CONFIG,
  isCoolingDown,
  setCooldown,
  detectEntireTriggers,
  determineAction,
} from "./sla-calculator";

export {
  type SLAConfig,
  type AdaptiveAction,
  type EntireTriggerType,
  type EntireTrigger,
  type AdaptiveEscalation,
  type Escalation,
  type AdaptiveSLAConfig,
  DEFAULT_SLA_CONFIG,
  DEFAULT_ADAPTIVE_SLA_CONFIG,
  isCoolingDown,
  setCooldown,
  clearCooldowns,
  determineAction,
  detectEntireTriggers,
} from "./sla-calculator";

export class AdaptiveSLAEngine {
  private entireAdapter: EntireAdapter | null;
  private eventBus: EventBus | null;
  private config: AdaptiveSLAConfig;
  private averageBurnRates = new Map<string, number>();
  private lastCheckpointTimes = new Map<string, number>();
  private unresponsiveSince = new Map<string, number>();

  constructor(opts?: {
    entireAdapter?: EntireAdapter;
    eventBus?: EventBus;
    config?: AdaptiveSLAConfig;
  }) {
    this.entireAdapter = opts?.entireAdapter ?? null;
    this.eventBus = opts?.eventBus ?? null;
    this.config = opts?.config ?? DEFAULT_ADAPTIVE_SLA_CONFIG;
  }

  setAverageBurnRate(taskId: string, rate: number): void {
    this.averageBurnRates.set(taskId, rate);
  }

  setLastCheckpointTime(taskId: string, time: number): void {
    this.lastCheckpointTimes.set(taskId, time);
  }

  markUnresponsive(taskId: string, since: number): void {
    this.unresponsiveSince.set(taskId, since);
  }

  clearUnresponsive(taskId: string): void {
    this.unresponsiveSince.delete(taskId);
  }

  checkAdaptiveTasks(
    tasks: Task[],
    entireMonitoringEnabled: boolean,
    now: number = Date.now(),
  ): AdaptiveEscalation[] {
    if (!entireMonitoringEnabled || !this.entireAdapter) return [];

    const escalations: AdaptiveEscalation[] = [];
    const cooldownMs = this.config.cooldownMinutes * 60_000;

    for (const task of tasks) {
      if (task.status !== "in_progress") continue;
      if (isCoolingDown(task.id, now, cooldownMs)) continue;

      const metrics = this.getMetricsForTask(task.id);
      if (!metrics) continue;

      const averageBurnRate = this.averageBurnRates.get(task.id) ?? 0;
      const lastCheckpointTime = this.lastCheckpointTimes.get(task.id) ?? now;

      const triggers = detectEntireTriggers(metrics, task.id, averageBurnRate, lastCheckpointTime, now, this.config);

      for (const trigger of triggers) {
        const characteristics = this.getTaskCharacteristics(task);
        const unresponsive = this.unresponsiveSince.get(task.id);
        const thresholdMs = this.config.noCheckpointMinutes * 60_000;
        const action = determineAction(trigger, characteristics, unresponsive, thresholdMs);

        escalations.push({
          taskId: task.id, taskTitle: task.title, currentStatus: task.status,
          assignee: task.assignee, action, trigger, characteristics,
        });

        if (this.eventBus) {
          if (trigger.type === "session_ended_incomplete") {
            this.eventBus.emit({ type: "SLA_BREACH", taskId: task.id, threshold: trigger.type, elapsed: metrics.elapsedMinutes });
          } else if (trigger.type === "no_checkpoint") {
            this.eventBus.emit({ type: "SLA_WARNING", taskId: task.id, threshold: trigger.type, elapsed: metrics.elapsedMinutes });
          } else {
            this.eventBus.emit({ type: "RESOURCE_WARNING", taskId: task.id, agent: trigger.agent, warning: trigger.detail });
          }
        }

        if (action === "auto_reassign" || action === "suggest_reassign") {
          setCooldown(task.id, now);
        }
      }
    }

    return escalations;
  }

  private getMetricsForTask(taskId: string): EntireSessionMetrics | null {
    if (!this.entireAdapter) return null;
    return this.entireAdapter.getSessionMetrics(taskId);
  }

  private getTaskCharacteristics(task: Task): TaskCharacteristics | undefined {
    if (!task.tags || task.tags.length === 0) return undefined;
    const characteristics: TaskCharacteristics = {};
    for (const tag of task.tags) {
      if (tag.startsWith("criticality:")) characteristics.criticality = tag.split(":")[1] as TaskCharacteristics["criticality"];
      if (tag.startsWith("reversibility:")) characteristics.reversibility = tag.split(":")[1] as TaskCharacteristics["reversibility"];
      if (tag.startsWith("complexity:")) characteristics.complexity = tag.split(":")[1] as TaskCharacteristics["complexity"];
    }
    return Object.keys(characteristics).length > 0 ? characteristics : undefined;
  }
}

export function humanTime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function lastEventTimestamp(task: Task, targetStatus: TaskStatus): number {
  for (let i = task.events.length - 1; i >= 0; i--) {
    const ev = task.events[i];
    if (ev.type === "status_changed" && ev.to === targetStatus) {
      return new Date(ev.timestamp).getTime();
    }
  }
  return new Date(task.createdAt).getTime();
}

export function checkStaleTasks(
  tasks: Task[],
  config: SLAConfig = DEFAULT_SLA_CONFIG,
  now: Date = new Date(),
): Escalation[] {
  const escalations: Escalation[] = [];
  const nowMs = now.getTime();

  for (const task of tasks) {
    if (task.status === "in_progress") {
      const isBlocked = task.tags?.includes("blocked") ?? false;
      const enteredAt = lastEventTimestamp(task, "in_progress");
      const staleForMs = nowMs - enteredAt;

      if (isBlocked) {
        if (staleForMs > config.blockedMaxMs) {
          escalations.push({ taskId: task.id, taskTitle: task.title, currentStatus: task.status, assignee: task.assignee, staleForMs, action: "escalate" });
        }
      } else if (staleForMs > config.inProgressMaxMs * 2) {
        escalations.push({ taskId: task.id, taskTitle: task.title, currentStatus: task.status, assignee: task.assignee, staleForMs, action: "reassign_suggestion" });
      } else if (staleForMs > config.inProgressMaxMs) {
        escalations.push({ taskId: task.id, taskTitle: task.title, currentStatus: task.status, assignee: task.assignee, staleForMs, action: "ping" });
      }
    } else if (task.status === "ready_for_review") {
      const enteredAt = lastEventTimestamp(task, "ready_for_review");
      const staleForMs = nowMs - enteredAt;
      if (staleForMs > config.reviewMaxMs) {
        escalations.push({ taskId: task.id, taskTitle: task.title, currentStatus: task.status, assignee: task.assignee, staleForMs, action: "ping" });
      }
    }
  }

  return escalations;
}

export function formatEscalationMessage(escalation: Escalation): string {
  const assigneeStr = escalation.assignee ?? "unassigned";
  const time = humanTime(escalation.staleForMs);

  switch (escalation.action) {
    case "ping":
      return `⏰ Task "${escalation.taskTitle}" has been ${escalation.currentStatus} for ${time}. Assignee: ${assigneeStr}`;
    case "reassign_suggestion":
      return `⚠️ Task "${escalation.taskTitle}" stale for ${time}. Consider reassigning from ${assigneeStr}.`;
    case "escalate":
      return `🚨 Task "${escalation.taskTitle}" blocked for ${time}. Needs immediate attention.`;
  }
}
