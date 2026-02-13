export interface AgentStats {
  totalSessions: number;
  totalMessages: number;
  todayActivity: { messageCount: number; sessionCount: number; toolCallCount: number } | null;
  todayTokens: Record<string, number> | null;
  weeklyActivity: Array<{ date: string; messageCount: number }>;
  modelUsage: Record<string, { inputTokens: number; outputTokens: number }>;
}

export interface QuotaEstimate {
  percent: number;
  confidence: "high" | "medium" | "low" | "none";
  label: string;
  details?: string;
}

export interface AgentProvider {
  id: string;
  displayName: string;
  buildLaunchCommand(configDir: string, opts: { dir?: string; resume?: boolean }): string[];
  parseStatsFromFile(statsPath: string, referenceDate?: string): Promise<AgentStats>;
  estimateQuota(recentMessageCount: number, policy: { plan: string; estimatedLimit: number; windowMs: number; source: string }): QuotaEstimate;
  supportsEntire: boolean;
}
