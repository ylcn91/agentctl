import chalk from "chalk";
import { loadConfig } from "../config";
import { ClaudeCodeProvider } from "../providers/claude-code";
import type { AccountConfig } from "../types";
import type { AgentStats } from "../providers/types";

const provider = new ClaudeCodeProvider();

interface AccountStatus {
  account: AccountConfig;
  stats: AgentStats;
  quotaLabel: string;
  quotaPercent: number;
}

async function getAccountStatuses(configPath?: string): Promise<AccountStatus[]> {
  const config = await loadConfig(configPath);
  const results: AccountStatus[] = [];

  for (const account of config.accounts) {
    const configDir = account.configDir.replace(/^~/, process.env.HOME ?? "");
    const statsPath = `${configDir}/stats-cache.json`;
    const stats = await provider.parseStatsFromFile(statsPath);
    const quotaPolicy = {
      ...config.defaults.quotaPolicy,
      ...(account.quotaPolicy ?? {}),
    };
    const quota = provider.estimateQuota(
      stats.todayActivity?.messageCount ?? 0,
      quotaPolicy
    );
    results.push({
      account,
      stats,
      quotaLabel: quota.label,
      quotaPercent: quota.percent,
    });
  }

  return results;
}

export async function statusCommand(configPath?: string): Promise<string> {
  const statuses = await getAccountStatuses(configPath);

  if (statuses.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const lines = statuses.map((s) => {
    const name = chalk.hex(s.account.color).bold(s.account.name);
    const msgs = s.stats.todayActivity?.messageCount ?? 0;
    const label = s.quotaPercent >= 0 ? s.quotaLabel : "unknown";
    return `${name}  ${msgs} msgs today  ${label}`;
  });

  return lines.join("\n");
}

export async function usageCommand(configPath?: string): Promise<string> {
  const statuses = await getAccountStatuses(configPath);

  if (statuses.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const header = `${"Account".padEnd(20)} ${"Today".padEnd(8)} ${"Total".padEnd(10)} ${"Quota".padEnd(20)}`;
  const divider = "-".repeat(header.length);

  const rows = statuses.map((s) => {
    const name = s.account.name.padEnd(20);
    const today = String(s.stats.todayActivity?.messageCount ?? 0).padEnd(8);
    const total = String(s.stats.totalMessages).padEnd(10);
    const quota = s.quotaPercent >= 0 ? s.quotaLabel : "unknown";
    return `${name} ${today} ${total} ${quota.padEnd(20)}`;
  });

  return [header, divider, ...rows].join("\n");
}

export async function listCommand(configPath?: string): Promise<string> {
  const config = await loadConfig(configPath);

  if (config.accounts.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const lines = config.accounts.map((a) => {
    const dot = chalk.hex(a.color)("\u25CF");
    const name = chalk.bold(a.name);
    const dir = chalk.gray(a.configDir);
    return `${dot} ${name} (${a.label}) ${dir}`;
  });

  return lines.join("\n");
}
