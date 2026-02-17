
export interface Account {
  name: string;
  configDir: string;
  provider: string;
}

export interface LaunchOpts {
  dir?: string;
  resume?: boolean;
  bypassPermissions?: boolean;
}

export interface RawUsageData {
  totalSessions: number;
  totalMessages: number;
  dailyActivity: Array<{ date: string; messageCount: number; sessionCount: number; toolCallCount: number }>;
  dailyModelTokens: Array<{ date: string; tokensByModel: Record<string, number> }>;
  modelUsage: Record<string, { inputTokens: number; outputTokens: number }>;
}

export interface UsageSource {
  type: "filesystem" | "api" | "process-output";
  read(): Promise<RawUsageData>;
}

export interface QuotaEstimate {
  percent: number;
  confidence: "high" | "medium" | "low" | "none";
  label: string;
  details?: string;
}

export interface QuotaPolicyOpts {
  recentMessageCount: number;
  estimatedLimit: number;
}

export interface QuotaPolicy {
  type: "rolling-window" | "fixed-reset" | "unlimited" | "unknown";
  windowMs?: number;
  estimateRemaining(usage: RawUsageData, opts: QuotaPolicyOpts): QuotaEstimate;
}

export interface AgentStats {
  totalSessions: number;
  totalMessages: number;
  todayActivity: { messageCount: number; sessionCount: number; toolCallCount: number } | null;
  todayTokens: Record<string, number> | null;
  weeklyActivity: Array<{ date: string; messageCount: number }>;
  modelUsage: Record<string, { inputTokens: number; outputTokens: number }>;
}

export interface ProcessInfo {
  pid: number;
  configDir: string;
  startedAt?: string;
}

export interface AgentProvider {
  id: string;
  displayName: string;
  icon: string;
  supportsEntire: boolean;

  detectRunning(account: Account): Promise<ProcessInfo | null>;

  buildLaunchCommand(account: Account, opts: LaunchOpts): string[];

  getUsageSource(account: Account): UsageSource;

  getQuotaPolicy(overrides?: { plan?: string; estimatedLimit?: number }): QuotaPolicy;

  parseStatsFromFile(statsPath: string, referenceDate?: string): Promise<AgentStats>;

  estimateQuota(
    recentMessageCount: number,
    policy: { plan: string; estimatedLimit: number; windowMs: number; source: string }
  ): QuotaEstimate;
}
