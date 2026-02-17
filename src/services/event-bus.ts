
import type { VerificationReceipt } from "./verification-receipts";
export type { VerificationReceipt };

export type StreamChunkType = "text" | "thinking" | "tool_use" | "tool_result" | "error" | "system";

export interface TaskCharacteristics {
  complexity?: "low" | "medium" | "high" | "critical";
  criticality?: "low" | "medium" | "high" | "critical";
  uncertainty?: "low" | "medium" | "high";
  verifiability?: "auto-testable" | "needs-review" | "subjective";
  reversibility?: "reversible" | "partial" | "irreversible";
}

export interface ProgressData {
  percent: number;
  currentStep: string;
  blockers?: string[];
  estimatedRemainingMinutes?: number;
  artifactsProduced?: string[];
}

export type DelegationEvent =
  | { type: "TASK_CREATED"; taskId: string; delegator: string; characteristics?: TaskCharacteristics }
  | { type: "TASK_ASSIGNED"; taskId: string; delegator: string; delegatee: string; reason: string }
  | { type: "TASK_STARTED"; taskId: string; agent: string }
  | { type: "CHECKPOINT_REACHED"; taskId: string; agent: string; percent: number; step: string }
  | { type: "RESOURCE_WARNING"; taskId: string; agent: string; warning: string }
  | { type: "PROGRESS_UPDATE"; taskId: string; agent: string; data: ProgressData }
  | { type: "SLA_WARNING"; taskId: string; threshold: string; elapsed: number }
  | { type: "SLA_BREACH"; taskId: string; threshold: string; elapsed: number }
  | { type: "TASK_COMPLETED"; taskId: string; agent: string; result: "success" | "failure" }
  | { type: "TASK_VERIFIED"; taskId: string; verifier: string; passed: boolean; receipt?: VerificationReceipt }
  | { type: "REASSIGNMENT"; taskId: string; from: string; to: string; trigger: string }
  | { type: "DELEGATION_CHAIN"; taskId: string; chain: string[] }
  | { type: "TRUST_UPDATE"; agent: string; delta: number; reason: string }
  | { type: "TDD_CYCLE_START"; testFile: string; phase: "red" | "green" | "refactor" }
  | { type: "TDD_TEST_PASS"; testFile: string; passCount: number; duration: number }
  | { type: "TDD_TEST_FAIL"; testFile: string; failCount: number; duration: number }
  | { type: "TDD_REFACTOR"; testFile: string }
  | { type: "TDD_TEST_OUTPUT"; testFile: string; line: string; stream: "stdout" | "stderr" }
  | { type: "AGENT_STREAM_START"; sessionId: string; account: string; provider: string; prompt?: string }
  | { type: "AGENT_STREAM_CHUNK"; sessionId: string; account: string; chunkType: StreamChunkType; content: string; toolName?: string; toolInput?: string }
  | { type: "AGENT_STREAM_END"; sessionId: string; account: string; durationMs: number; tokenCount?: number; cost?: number }
  | { type: "COUNCIL_SESSION_START"; councilSessionId: string; goal: string; stage: string; members: string[] }
  | { type: "COUNCIL_STAGE_START"; councilSessionId: string; stage: string }
  | { type: "COUNCIL_STAGE_COMPLETE"; councilSessionId: string; stage: string; results: unknown }
  | { type: "COUNCIL_MEMBER_RESPONSE"; councilSessionId: string; account: string; stage: string; content: string; role: "member" | "chairman" }
  | { type: "COUNCIL_SESSION_END"; councilSessionId: string; verdict?: string; confidence?: number }
  | { type: "COUNCIL_DISCUSSION_START"; sessionId: string; goal: string; members: string[]; chairman: string }
  | { type: "COUNCIL_RESEARCH_START"; sessionId: string; account: string }
  | { type: "COUNCIL_RESEARCH_DONE"; sessionId: string; account: string; toolCount: number }
  | { type: "COUNCIL_DISCUSSION_ROUND"; sessionId: string; round: number; account: string }
  | { type: "COUNCIL_DECISION_START"; sessionId: string; chairman: string }
  | { type: "COUNCIL_DISCUSSION_END"; sessionId: string }
  | { type: "TASK_ESCALATED"; taskId: string; rejectionCount: number; reason: string }
  | { type: "CIRCUIT_BREAKER_OPEN"; agent: string; trigger: string; reason: string; revokedTaskIds: string[] }
  | { type: "CIRCUIT_BREAKER_CLOSED"; agent: string }
  | { type: "ACCOUNT_HEALTH"; agent: string; status: "healthy" | "degraded" | "critical"; latencyMs?: number }
  | { type: "DELEGATION_START"; delegationId: string; from: string; to: string; instruction: string; depth: number }
  | { type: "DELEGATION_CHUNK"; delegationId: string; from: string; to: string; chunkType: StreamChunkType; content: string }
  | { type: "DELEGATION_END"; delegationId: string; from: string; to: string; durationMs: number; success: boolean; toolCallCount: number }
  | { type: "WORKFLOW_STEP_STARTED"; runId: string; stepId: string; assignee: string; workflowName: string }
  | { type: "WORKFLOW_STEP_PROGRESS"; runId: string; stepId: string; assignee: string; detail: string }
  | { type: "WORKFLOW_STEP_COMPLETED"; runId: string; stepId: string; result: string; durationMs: number }
  | { type: "WORKFLOW_STEP_FAILED"; runId: string; stepId: string; error: string; attempt: number; willRetry: boolean }
  | { type: "WORKFLOW_STARTED"; runId: string; workflowName: string; stepCount: number }
  | { type: "WORKFLOW_COMPLETED"; runId: string; workflowName: string; durationMs: number; status: string }
  | { type: "WORKFLOW_CANCELLED"; runId: string };

export type DelegationEventType = DelegationEvent["type"];

export type EventHandler = (event: DelegationEvent & { id: string; timestamp: string }) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private recentEvents: Array<DelegationEvent & { id: string; timestamp: string }> = [];
  private maxRecent: number;

  constructor(opts?: { maxRecent?: number }) {
    this.maxRecent = opts?.maxRecent ?? 1000;
  }

  emit(event: DelegationEvent): string {
    const id = crypto.randomUUID();
    const timestamped = { ...event, id, timestamp: new Date().toISOString() };

    this.recentEvents.push(timestamped);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents.shift();
    }

    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try { handler(timestamped); } catch (e: any) {
          console.error(`[event-bus] handler error for ${event.type}:`, e.message);
        }
      }
    }

    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try { handler(timestamped); } catch (e: any) {
          console.error("[event-bus] wildcard handler error:", e.message);
        }
      }
    }

    return id;
  }

  on(eventType: DelegationEventType | "*", handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  getRecent(opts?: { type?: DelegationEventType; taskId?: string; limit?: number }): Array<DelegationEvent & { id: string; timestamp: string }> {
    let events = this.recentEvents;
    if (opts?.type) {
      events = events.filter((e) => e.type === opts.type);
    }
    if (opts?.taskId) {
      events = events.filter((e) => "taskId" in e && (e as any).taskId === opts.taskId);
    }
    const limit = opts?.limit ?? 50;
    return events.slice(-limit);
  }

  clear(): void {
    this.recentEvents = [];
    this.handlers.clear();
  }
}
