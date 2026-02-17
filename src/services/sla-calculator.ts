
import type { EntireSessionMetrics } from "./entire-adapter";
import type { TaskCharacteristics } from "./event-bus";
import type { TaskStatus } from "./tasks";

export interface SLAConfig {
  inProgressMaxMs: number;
  blockedMaxMs: number;
  reviewMaxMs: number;
  checkIntervalMs: number;
}

export const DEFAULT_SLA_CONFIG: SLAConfig = {
  inProgressMaxMs: 30 * 60 * 1000,
  blockedMaxMs: 15 * 60 * 1000,
  reviewMaxMs: 10 * 60 * 1000,
  checkIntervalMs: 60 * 1000,
};

export type AdaptiveAction =
  | "ping"
  | "suggest_reassign"
  | "auto_reassign"
  | "escalate_human"
  | "terminate";

export type EntireTriggerType =
  | "token_burn_rate"
  | "no_checkpoint"
  | "context_saturation"
  | "session_ended_incomplete";

export interface EntireTrigger {
  type: EntireTriggerType;
  taskId: string;
  sessionId: string;
  agent: string;
  detail: string;
  metrics?: EntireSessionMetrics;
}

export interface AdaptiveEscalation {
  taskId: string;
  taskTitle: string;
  currentStatus: TaskStatus;
  assignee?: string;
  action: AdaptiveAction;
  trigger: EntireTrigger;
  alternatives?: string[];
  characteristics?: TaskCharacteristics;
}

export interface Escalation {
  taskId: string;
  taskTitle: string;
  currentStatus: TaskStatus;
  assignee?: string;
  staleForMs: number;
  action: "ping" | "reassign_suggestion" | "escalate";
}

export interface AdaptiveSLAConfig {
  tokenBurnRateMultiplier: number;
  noCheckpointMinutes: number;
  contextSaturationThreshold: number;
  cooldownMinutes: number;
  terminateUnresponsiveMultiplier: number;
}

export const DEFAULT_ADAPTIVE_SLA_CONFIG: AdaptiveSLAConfig = {
  tokenBurnRateMultiplier: 2,
  noCheckpointMinutes: 10,
  contextSaturationThreshold: 0.8,
  cooldownMinutes: 15,
  terminateUnresponsiveMultiplier: 2,
};

const cooldowns = new Map<string, number>();

export function isCoolingDown(taskId: string, now: number, cooldownMs: number): boolean {
  const lastAction = cooldowns.get(taskId);
  if (!lastAction) return false;
  return (now - lastAction) < cooldownMs;
}

export function setCooldown(taskId: string, now: number): void {
  cooldowns.set(taskId, now);
}

export function clearCooldowns(): void {
  cooldowns.clear();
}

export function determineAction(
  trigger: EntireTrigger,
  characteristics?: TaskCharacteristics,
  unresponsiveSince?: number,
  thresholdMs?: number,
): AdaptiveAction {
  const terminateMultiplier = DEFAULT_ADAPTIVE_SLA_CONFIG.terminateUnresponsiveMultiplier;

  if (unresponsiveSince !== undefined && thresholdMs !== undefined) {
    const unresponsiveMs = Date.now() - unresponsiveSince;
    if (unresponsiveMs > thresholdMs * terminateMultiplier) {
      return "terminate";
    }
  }

  if (characteristics?.reversibility === "irreversible") {
    return "escalate_human";
  }

  if (
    trigger.type === "session_ended_incomplete" ||
    trigger.type === "context_saturation"
  ) {
    if (
      characteristics?.criticality === "high" ||
      characteristics?.criticality === "critical"
    ) {
      return "auto_reassign";
    }
    return "suggest_reassign";
  }

  if (trigger.type === "token_burn_rate" || trigger.type === "no_checkpoint") {
    return "ping";
  }

  return "ping";
}

export function detectEntireTriggers(
  metrics: EntireSessionMetrics,
  taskId: string,
  averageBurnRate: number,
  lastCheckpointTime: number,
  now: number,
  config: AdaptiveSLAConfig = DEFAULT_ADAPTIVE_SLA_CONFIG,
): EntireTrigger[] {
  const triggers: EntireTrigger[] = [];

  if (averageBurnRate > 0 && metrics.tokenBurnRate > averageBurnRate * config.tokenBurnRateMultiplier) {
    triggers.push({
      type: "token_burn_rate",
      taskId, sessionId: metrics.sessionId, agent: metrics.agentType,
      detail: `Burn rate ${Math.round(metrics.tokenBurnRate)}/min exceeds ${config.tokenBurnRateMultiplier}x average (${Math.round(averageBurnRate)}/min)`,
      metrics,
    });
  }

  const minutesSinceCheckpoint = (now - lastCheckpointTime) / 60_000;
  if (minutesSinceCheckpoint > config.noCheckpointMinutes) {
    triggers.push({
      type: "no_checkpoint",
      taskId, sessionId: metrics.sessionId, agent: metrics.agentType,
      detail: `No checkpoint for ${Math.round(minutesSinceCheckpoint)} minutes (threshold: ${config.noCheckpointMinutes}min)`,
      metrics,
    });
  }

  if (metrics.contextSaturation > config.contextSaturationThreshold) {
    triggers.push({
      type: "context_saturation",
      taskId, sessionId: metrics.sessionId, agent: metrics.agentType,
      detail: `Context at ${Math.round(metrics.contextSaturation * 100)}% (threshold: ${Math.round(config.contextSaturationThreshold * 100)}%)`,
      metrics,
    });
  }

  if (metrics.phase === "ended") {
    triggers.push({
      type: "session_ended_incomplete",
      taskId, sessionId: metrics.sessionId, agent: metrics.agentType,
      detail: `Session ended but task "${taskId}" still in progress`,
      metrics,
    });
  }

  return triggers;
}
