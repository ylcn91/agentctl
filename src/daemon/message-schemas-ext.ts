
import { z } from "zod";

const requestId = z.string().optional();

export const SearchKnowledgeMessage = z.object({
  type: z.literal("search_knowledge"),
  query: z.string().min(1),
  category: z.string().optional(),
  limit: z.number().int().positive().optional(),
  requestId,
});

export const IndexNoteMessage = z.object({
  type: z.literal("index_note"),
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  requestId,
});

export const ShareSessionMessage = z.object({
  type: z.literal("share_session"),
  target: z.string().min(1),
  workspace: z.string().optional(),
  requestId,
});

export const JoinSessionMessage = z.object({
  type: z.literal("join_session"),
  sessionId: z.string().min(1),
  requestId,
});

export const SessionBroadcastMessage = z.object({
  type: z.literal("session_broadcast"),
  sessionId: z.string().min(1),
  data: z.unknown(),
  requestId,
});

export const SessionStatusMessage = z.object({
  type: z.literal("session_status"),
  sessionId: z.string().optional(),
  requestId,
});

export const SessionHistoryMessage = z.object({
  type: z.literal("session_history"),
  sessionId: z.string().min(1),
  requestId,
});

export const LeaveSessionMessage = z.object({
  type: z.literal("leave_session"),
  sessionId: z.string().min(1),
  requestId,
});

export const SessionPingMessage = z.object({
  type: z.literal("session_ping"),
  sessionId: z.string().min(1),
  requestId,
});

export const NameSessionMessage = z.object({
  type: z.literal("name_session"),
  sessionId: z.string().min(1),
  name: z.string().min(1),
  account: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  requestId,
});

export const ListSessionsMessage = z.object({
  type: z.literal("list_sessions"),
  account: z.string().optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  requestId,
});

export const SearchSessionsMessage = z.object({
  type: z.literal("search_sessions"),
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
  requestId,
});

export const WorkflowTriggerMessage = z.object({
  type: z.literal("workflow_trigger"),
  workflowName: z.string().min(1),
  context: z.string().optional(),
  requestId,
});

export const WorkflowStatusMessage = z.object({
  type: z.literal("workflow_status"),
  runId: z.string().min(1),
  requestId,
});

export const WorkflowListMessage = z.object({
  type: z.literal("workflow_list"),
  requestId,
});

export const WorkflowCancelMessage = z.object({
  type: z.literal("workflow_cancel"),
  runId: z.string().min(1),
  requestId,
});

export const HealthCheckMessage = z.object({
  type: z.literal("health_check"),
  requestId,
});

export const HealthStatusMessage = z.object({
  type: z.literal("health_status"),
  requestId,
});

export const QueryActivityMessage = z.object({
  type: z.literal("query_activity"),
  activityType: z.string().optional(),
  account: z.string().optional(),
  workflowRunId: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().optional(),
  requestId,
});

export const SearchCodeMessage = z.object({
  type: z.literal("search_code"),
  pattern: z.string().min(1),
  targets: z.array(z.string()).optional(),
  maxResults: z.number().int().positive().optional(),
  requestId,
});

export const ReplaySessionMessage = z.object({
  type: z.literal("replay_session"),
  sessionId: z.string().min(1),
  repoPath: z.string().min(1),
  requestId,
});

export const LinkTaskMessage = z.object({
  type: z.literal("link_task"),
  taskId: z.string().min(1),
  url: z.string().optional(),
  externalId: z.string().optional(),
  provider: z.string().optional(),
  linkType: z.string().optional(),
  requestId,
});

export const GetTaskLinksMessage = z.object({
  type: z.literal("get_task_links"),
  taskId: z.string().min(1),
  requestId,
});

export const GetReviewBundleMessage = z.object({
  type: z.literal("get_review_bundle"),
  taskId: z.string().min(1),
  requestId,
});

export const GenerateReviewBundleMessage = z.object({
  type: z.literal("generate_review_bundle"),
  taskId: z.string().min(1),
  workDir: z.string().optional(),
  baseBranch: z.string().optional(),
  branch: z.string().optional(),
  runCommands: z.array(z.string()).optional(),
  requestId,
});

export const GetAnalyticsMessage = z.object({
  type: z.literal("get_analytics"),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  requestId,
});

export const RetroStartSessionMessage = z.object({
  type: z.literal("retro_start_session"),
  workflowRunId: z.string().optional(),
  participants: z.array(z.string()).optional(),
  chairman: z.string().optional(),
  requestId,
});

export const RetroSubmitReviewMessage = z.object({
  type: z.literal("retro_submit_review"),
  retroId: z.string().min(1),
  whatWentWell: z.array(z.string()).optional(),
  whatDidntWork: z.array(z.string()).optional(),
  suggestions: z.array(z.string()).optional(),
  agentPerformanceNotes: z.record(z.unknown()).optional(),
  requestId,
});

export const RetroSubmitSynthesisMessage = z.object({
  type: z.literal("retro_submit_synthesis"),
  retroId: z.string().min(1),
  document: z.unknown(),
  requestId,
});

export const RetroStatusMessage = z.object({
  type: z.literal("retro_status"),
  retroId: z.string().min(1),
  requestId,
});

export const RetroGetPastLearningsMessage = z.object({
  type: z.literal("retro_get_past_learnings"),
  requestId,
});

export const SubscribeMessage = z.object({
  type: z.literal("subscribe"),
  patterns: z.array(z.string()).optional(),
  requestId,
});

export const UnsubscribeMessage = z.object({
  type: z.literal("unsubscribe"),
  patterns: z.array(z.string()).optional(),
  requestId,
});
