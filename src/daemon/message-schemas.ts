
import { z } from "zod";

const requestId = z.string().optional();

export const AuthMessage = z.object({
  type: z.literal("auth"),
  account: z.string().min(1),
  token: z.string().min(1),
  requestId,
});

export const PingMessage = z.object({
  type: z.literal("ping"),
  requestId,
});

export const ConfigReloadMessage = z.object({
  type: z.literal("config_reload"),
  requestId,
});

export const SendMessageMsg = z.object({
  type: z.literal("send_message"),
  to: z.string().min(1),
  content: z.string().min(1),
  requestId,
});

export const CountUnreadMessage = z.object({
  type: z.literal("count_unread"),
  requestId,
});

export const ReadMessagesMessage = z.object({
  type: z.literal("read_messages"),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  requestId,
});

export const ListAccountsMessage = z.object({
  type: z.literal("list_accounts"),
  requestId,
});

export const ArchiveMessagesMessage = z.object({
  type: z.literal("archive_messages"),
  days: z.number().int().min(1).optional(),
  requestId,
});

export const HandoffTaskMessage = z.object({
  type: z.literal("handoff_task"),
  to: z.string().min(1),
  payload: z.record(z.unknown()),
  context: z.record(z.unknown()).optional(),
  requestId,
});

export const ReauthorizeDelegationMessage = z.object({
  type: z.literal("reauthorize_delegation"),
  handoffId: z.string().min(1),
  newMaxDepth: z.number().int().min(1),
  requestId,
});

export const HandoffAcceptMessage = z.object({
  type: z.literal("handoff_accept"),
  handoffId: z.string().min(1),
  requestId,
});

export const SuggestAssigneeMessage = z.object({
  type: z.literal("suggest_assignee"),
  skills: z.array(z.string()).optional(),
  excludeAccounts: z.array(z.string()).optional(),
  priority: z.string().optional(),
  requestId,
});

export const UpdateTaskStatusMessage = z.object({
  type: z.literal("update_task_status"),
  taskId: z.string().min(1),
  status: z.enum(["todo", "in_progress", "ready_for_review", "accepted", "rejected"]),
  reason: z.string().optional(),
  workspacePath: z.string().optional(),
  branch: z.string().optional(),
  workspaceId: z.string().optional(),
  requestId,
});

export const ReportProgressMessage = z.object({
  type: z.literal("report_progress"),
  taskId: z.string().min(1),
  percent: z.number().min(0).max(100),
  agent: z.string().optional(),
  currentStep: z.string().optional(),
  blockers: z.array(z.string()).optional(),
  estimatedRemainingMinutes: z.number().optional(),
  artifactsProduced: z.array(z.string()).optional(),
  requestId,
});

export const AdaptiveSlaCheckMessage = z.object({
  type: z.literal("adaptive_sla_check"),
  config: z.record(z.unknown()).optional(),
  requestId,
});

export const GetTrustMessage = z.object({
  type: z.literal("get_trust"),
  account: z.string().optional(),
  requestId,
});

export const ReinstateAgentMessage = z.object({
  type: z.literal("reinstate_agent"),
  account: z.string().min(1),
  requestId,
});

export const CheckCircuitBreakerMessage = z.object({
  type: z.literal("check_circuit_breaker"),
  account: z.string().optional(),
  requestId,
});

export const PrepareWorktreeMessage = z.object({
  type: z.literal("prepare_worktree_for_handoff"),
  repoPath: z.string().min(1),
  branch: z.string().min(1),
  handoffId: z.string().optional(),
  requestId,
});

export const GetWorkspaceStatusMessage = z.object({
  type: z.literal("get_workspace_status"),
  id: z.string().optional(),
  repoPath: z.string().optional(),
  branch: z.string().optional(),
  requestId,
});

export const CleanupWorkspaceMessage = z.object({
  type: z.literal("cleanup_workspace"),
  id: z.string().min(1),
  requestId,
});

export const CouncilAnalyzeMessage = z.object({
  type: z.literal("council_analyze"),
  goal: z.string().min(1),
  context: z.unknown().optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  requestId,
});

export const CouncilVerifyMessage = z.object({
  type: z.literal("council_verify"),
  taskId: z.string().min(1),
  goal: z.string().min(1),
  acceptance_criteria: z.array(z.string()),
  diff: z.string().optional(),
  testResults: z.string().optional(),
  filesChanged: z.array(z.string()).optional(),
  riskNotes: z.array(z.string()).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  requestId,
});

export const CouncilDiscussionMessage = z.object({
  type: z.literal("council_discussion"),
  goal: z.string().min(1),
  context: z.string().optional(),
  maxRounds: z.number().int().min(1).max(5).optional(),
  researchTimeoutMs: z.number().int().min(1000).optional(),
  discussionTimeoutMs: z.number().int().min(1000).optional(),
  decisionTimeoutMs: z.number().int().min(1000).optional(),
  requestId,
});

export const CouncilHistoryMessage = z.object({
  type: z.literal("council_history"),
  requestId,
});
