import type { AgentProvider, AgentStats, QuotaEstimate } from "./types";

export class ClaudeCodeProvider implements AgentProvider {
  id = "claude-code";
  displayName = "Claude Code";
  supportsEntire = true;

  buildLaunchCommand(configDir: string, opts: { dir?: string; resume?: boolean }): string[] {
    const env = `CLAUDE_CONFIG_DIR=${configDir}`;
    const args = ["claude"];
    if (opts.resume) args.push("--resume");
    if (opts.dir) args.push("--dir", opts.dir);
    return [env, ...args];
  }

  async parseStatsFromFile(statsPath: string, referenceDate?: string): Promise<AgentStats> {
    const empty: AgentStats = {
      totalSessions: 0,
      totalMessages: 0,
      todayActivity: null,
      todayTokens: null,
      weeklyActivity: [],
      modelUsage: {},
    };

    try {
      const file = Bun.file(statsPath);
      if (!(await file.exists())) return empty;
      const raw = (await file.json()) as any;

      const today = referenceDate ?? new Date().toISOString().split("T")[0];
      const todayActivity =
        raw.dailyActivity?.find((d: any) => d.date === today) ?? null;
      const todayTokenEntry = raw.dailyModelTokens?.find(
        (d: any) => d.date === today
      );
      const todayTokens = todayTokenEntry?.tokensByModel ?? null;

      // Last 7 days of activity
      const weeklyActivity = (raw.dailyActivity ?? [])
        .slice(-7)
        .map((d: any) => ({ date: d.date, messageCount: d.messageCount ?? 0 }));

      // Model usage totals
      const modelUsage: Record<
        string,
        { inputTokens: number; outputTokens: number }
      > = {};
      for (const [model, usage] of Object.entries(raw.modelUsage ?? {})) {
        const u = usage as any;
        modelUsage[model] = {
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
        };
      }

      return {
        totalSessions: raw.totalSessions ?? 0,
        totalMessages: raw.totalMessages ?? 0,
        todayActivity,
        todayTokens,
        weeklyActivity,
        modelUsage,
      };
    } catch {
      return empty;
    }
  }

  estimateQuota(
    recentMessageCount: number,
    policy: {
      plan: string;
      estimatedLimit: number;
      windowMs: number;
      source: string;
    }
  ): QuotaEstimate {
    if (policy.plan === "unknown" || !policy.estimatedLimit) {
      return {
        percent: -1,
        confidence: "none",
        label: "quota: unknown plan",
        details: "Set plan in config",
      };
    }

    const percent = Math.min(
      (recentMessageCount / policy.estimatedLimit) * 100,
      100
    );
    const windowHours = policy.windowMs / (60 * 60 * 1000);

    return {
      percent,
      confidence: recentMessageCount > 0 ? "medium" : "low",
      label: `~${Math.round(percent)}% (est.)`,
      details: `${recentMessageCount}/${policy.estimatedLimit} msgs in ${windowHours}h window`,
    };
  }
}
