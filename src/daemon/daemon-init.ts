import { mkdirSync } from "fs";
import { join } from "path";
import type { DaemonState } from "./state";
import type { DaemonFeatures } from "./handler-types";
import { loadTasks } from "../services/tasks";
import { checkStaleTasks, formatEscalationMessage, DEFAULT_SLA_CONFIG } from "../services/sla-engine";
import { sendNotification } from "../services/notifications";
import { startWatchdog } from "./watchdog";
import { getHubDir } from "../paths";
import { createLogger } from "../services/logger";
const logger = createLogger("daemon-init");

export interface DaemonInitOpts {
  workspaceDbPath?: string;
  capabilityDbPath?: string;
  knowledgeDbPath?: string;
  activityDbPath?: string;
  workflowDbPath?: string;
  retroDbPath?: string;
  sessionsDbPath?: string;
  trustDbPath?: string;
  entireGitDir?: string;
}

export interface DaemonInitResult {
  watchdog?: { stop: () => void };
  entireAdapter?: import("../services/entire-adapter").EntireAdapter;
}

export async function initDaemonFeatures(
  state: DaemonState,
  features: DaemonFeatures | undefined,
  opts: DaemonInitOpts,
): Promise<DaemonInitResult> {
  if (features?.workspaceWorktree) {
    state.initWorkspace(opts.workspaceDbPath);
  }
  if (features?.capabilityRouting) {
    state.initCapabilities(opts.capabilityDbPath);
  }
  if (features?.slaEngine) {
    state.slaTimerId = setInterval(async () => {
      try {
        const board = await loadTasks();
        const escalations = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG);
        for (const esc of escalations) {
          sendNotification("agentctl SLA", formatEscalationMessage(esc)).catch(e => logger.error("SLA escalation failed", { error: e.message }));
        }
      } catch(e: any) { logger.error("SLA check failed", { error: e.message }) }
    }, DEFAULT_SLA_CONFIG.checkIntervalMs);
  }
  if (features?.knowledgeIndex) {
    state.initKnowledge(opts.knowledgeDbPath);
  }
  if (features?.githubIntegration) {
    state.initExternalLinks();
  }
  if (features?.workflow || features?.retro) {
    state.initActivity(opts.activityDbPath);
  }
  if (features?.workflow) {
    state.initWorkflow(opts.workflowDbPath);
    mkdirSync(join(getHubDir(), "workflows"), { recursive: true });
  }
  if (features?.retro) {
    state.initRetro(opts.retroDbPath);
  }
  if (features?.sessions) {
    state.initSessions(opts.sessionsDbPath);
  }
  if (features?.trust) {
    state.initTrust(opts.trustDbPath);
  }
  if (features?.circuitBreaker) {
    state.initCircuitBreaker();
  }

  let entireAdapter: import("../services/entire-adapter").EntireAdapter | undefined;
  if (features?.entireMonitoring && opts.entireGitDir) {
    try {
      const { EntireAdapter } = await import("../services/entire-adapter");
      entireAdapter = new EntireAdapter(state.eventBus, opts.entireGitDir);
      entireAdapter.startWatching();
    } catch (e: any) {
      logger.error("entire-adapter init failed", { error: e.message });
    }
  }

  if (features?.streaming) {
    state.eventBus.on("*", (event) => {
      state.subscriptionRegistry.broadcast(event);
    });
  }

  if (state.activityStore) {
    const activityStore = state.activityStore;
    state.eventBus.on("*", (event) => {
      const typeMap: Record<string, string> = {
        TASK_CREATED: "task_created",
        TASK_ASSIGNED: "task_assigned",
        TASK_STARTED: "task_started",
        TASK_COMPLETED: "task_completed",
        TASK_VERIFIED: "task_verified",
        CHECKPOINT_REACHED: "checkpoint_reached",
        PROGRESS_UPDATE: "progress_update",
        SLA_WARNING: "sla_warning",
        SLA_BREACH: "sla_breach",
        REASSIGNMENT: "reassignment",
        TRUST_UPDATE: "trust_update",
        DELEGATION_CHAIN: "delegation_chain",
      };
      const activityType = typeMap[event.type];
      if (!activityType) return;
      const agent = ("agent" in event ? event.agent : undefined)
        ?? ("delegator" in event ? event.delegator : undefined)
        ?? "system";
      const taskId = "taskId" in event ? (event as any).taskId : undefined;
      activityStore.emit({
        type: activityType as any,
        timestamp: event.timestamp,
        account: agent,
        taskId,
        metadata: { ...event },
      });
    });
  }

  try {
    const { EventLog } = await import("../services/event-log");
    const eventLog = new EventLog();
    eventLog.subscribe(state.eventBus);
  } catch (e: any) {
    logger.error("event-log init failed", { error: e.message });
  }

  let watchdog: { stop: () => void } | undefined;
  if (features?.reliability) {
    watchdog = startWatchdog(state, state.startedAt);
  }

  return { watchdog, entireAdapter };
}
