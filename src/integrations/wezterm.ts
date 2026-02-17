export function isWezTerm(): boolean {
  return !!process.env.WEZTERM_PANE;
}

export interface WezTermTab {
  accountName: string;
  color: string;
  command: string;
}

export function setTabTitle(accountName: string): string {
  return `wezterm cli set-tab-title "${accountName}"`;
}

export async function launchInWezTermTab(account: { name: string; color: string; configDir: string }, dir?: string): Promise<void> {
  if (!isWezTerm()) return;

  const configDir = account.configDir.replace(/^~/, process.env.HOME ?? "");
  const cmd = `CLAUDE_CONFIG_DIR=${configDir} claude`;
  const cwd = dir ?? process.env.HOME ?? "/";

  const spawnProc = Bun.spawn(
    ["wezterm", "cli", "spawn", "--cwd", cwd, "--", "bash", "-c", cmd],
    { stdout: "ignore", stderr: "ignore" }
  );
  await spawnProc.exited;

  const titleProc = Bun.spawn(
    ["wezterm", "cli", "set-tab-title", account.name],
    { stdout: "ignore", stderr: "ignore" }
  );
  await titleProc.exited;
}

export function generateWorkspaceConfig(accounts: Array<{ name: string; color: string; configDir: string }>): string {

  const panes = accounts.map((a) => {
    const configDir = a.configDir.replace(/^~/, process.env.HOME ?? "");
    return `    { args = { "bash", "-c", "CLAUDE_CONFIG_DIR=${configDir} claude" }, set_environment_variables = { CLAUDE_CONFIG_DIR = "${configDir}" } }`;
  });

  return `-- agentctl workspace preset
local workspace = {
  workspace_id = "agentctl",
  tabs = {
${panes.join(",\n")}
  }
}`;
}
