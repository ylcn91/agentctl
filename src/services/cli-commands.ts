import chalk from "chalk";
import { loadConfig } from "../config";
import { loadDashboardData } from "../application/use-cases/load-dashboard-data.js";
import { launchAccount } from "../application/use-cases/launch-account.js";

export async function statusCommand(configPath?: string): Promise<string> {
  const data = await loadDashboardData(configPath);

  if (data.accounts.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const lines = data.accounts.map((s) => {
    const name = chalk.hex(s.account.color).bold(s.account.name);
    const msgs = s.stats.todayActivity?.messageCount ?? 0;
    const label = s.quota.percent >= 0 ? s.quota.label : "unknown";
    return `${name}  ${msgs} msgs today  ${label}`;
  });

  return lines.join("\n");
}

export async function usageCommand(configPath?: string): Promise<string> {
  const data = await loadDashboardData(configPath);

  if (data.accounts.length === 0) {
    return "No accounts configured. Run: ch add <name>";
  }

  const header = `${"Account".padEnd(20)} ${"Today".padEnd(8)} ${"Total".padEnd(10)} ${"Quota".padEnd(20)}`;
  const divider = "-".repeat(header.length);

  const rows = data.accounts.map((s) => {
    const name = s.account.name.padEnd(20);
    const today = String(s.stats.todayActivity?.messageCount ?? 0).padEnd(8);
    const total = String(s.stats.totalMessages).padEnd(10);
    const quota = s.quota.percent >= 0 ? s.quota.label : "unknown";
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

export async function launchCommand(
  accountName: string,
  dir?: string,
  opts?: { resume?: boolean; noWindow?: boolean; bypassPermissions?: boolean; noEntire?: boolean }
): Promise<string> {
  const result = await launchAccount(accountName, {
    dir,
    resume: opts?.resume,
    noWindow: opts?.noWindow,
    bypassPermissions: opts?.bypassPermissions,
    noEntire: opts?.noEntire,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Launch failed");
  }

  if (opts?.noWindow) {
    return result.shellCmd;
  }

  return `Launched ${accountName} in ${result.terminalName ?? "terminal"} (dir: ${dir ?? process.cwd()})`;
}
