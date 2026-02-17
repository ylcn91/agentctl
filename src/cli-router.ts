
import { handleConfig, handleSearch, handleReplay, handleSession, handleSessions, handleTdd } from "./cli-handlers.js";

interface CliContext {
  command?: string;
  subcommand?: string;
  input: string[];
  flags: {
    account?: string;
    dir?: string;
    color?: string;
    label?: string;
    purge: boolean;
    resume: boolean;
    noWindow: boolean;
    bypassPermissions: boolean;
    noEntire: boolean;
    provider?: string;
    json: boolean;
    search?: string;
    watch: boolean;
    apiKey: boolean;
  };
}

export async function routeCommand(ctx: CliContext): Promise<void> {
  const { command, subcommand, input, flags } = ctx;

  if (command === "daemon" && subcommand === "start") {
    const { ensureDaemonRunning } = await import("./mcp/bridge.js");
    try {
      await ensureDaemonRunning();
      console.log("agentctl daemon started (background)");
    } catch (e: any) {
      console.error(`Failed to start daemon: ${e.message}`);
      process.exit(1);
    }
  } else if (command === "daemon" && subcommand === "status") {
    const { daemonStatusCommand } = await import("./daemon/server.js");
    console.log(daemonStatusCommand());
  } else if (command === "daemon" && subcommand === "stop") {
    const { stopDaemonByPid } = await import("./daemon/server.js");
    stopDaemonByPid();
  } else if (command === "daemon" && subcommand === "supervise") {
    const { startSupervisor } = await import("./daemon/supervisor.js");
    const { getSockPath } = await import("./paths.js");
    const DAEMON_SOCK = getSockPath();
    const daemonScript = new URL("./daemon/index.ts", import.meta.url).pathname;
    const supervisor = startSupervisor({ sockPath: DAEMON_SOCK, daemonScript });
    console.log("agentctl daemon supervisor started");
    process.on("SIGINT", async () => { await supervisor.stop(); process.exit(0); });
    process.on("SIGTERM", async () => { await supervisor.stop(); process.exit(0); });
  } else if (command === "add") {
    await handleAdd(subcommand, flags);
  } else if (command === "remove") {
    await handleRemove(subcommand, flags);
  } else if (command === "rotate-token") {
    await handleRotateToken(subcommand);
  } else if (command === "auth") {
    await handleAuth(subcommand, input, flags);
  } else if (command === "bridge" && flags.account) {
    const { startBridge } = await import("./mcp/bridge.js");
    try {
      await startBridge(flags.account);
    } catch (e: any) {
      console.error(`Bridge error: ${e.message}`);
      process.exit(1);
    }
  } else if (command === "launch") {
    await handleLaunch(subcommand, input, flags);
  } else if (command === "status") {
    const { statusCommand } = await import("./services/cli-commands.js");
    console.log(await statusCommand());
  } else if (command === "usage") {
    const { usageCommand } = await import("./services/cli-commands.js");
    console.log(await usageCommand());
  } else if (command === "list") {
    const { listCommand } = await import("./services/cli-commands.js");
    console.log(await listCommand());
  } else if (command === "find") {
    await handleFind(subcommand);
  } else if (command === "config") {
    await handleConfig(subcommand, input, flags);
  } else if (command === "search") {
    await handleSearch(subcommand);
  } else if (command === "health") {
    const { healthCommand } = await import("./services/cli-commands.js");
    try {
      console.log(await healthCommand(subcommand));
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  } else if (command === "replay") {
    await handleReplay(subcommand, flags);
  } else if (command === "session") {
    await handleSession(subcommand, input, flags);
  } else if (command === "sessions") {
    await handleSessions(flags);
  } else if (command === "tdd") {
    await handleTdd(subcommand, flags);
  } else if (command === "help") {
    const { showHelp } = await import("./services/help.js");
    console.log(showHelp(subcommand));
  } else {

    const { startTui } = await import("./tui/app.js");
    await startTui();
  }
}

async function handleAdd(name: string | undefined, flags: CliContext["flags"]) {
  if (!name) { console.error("Usage: actl add <name>"); process.exit(1); }
  const { AddAccountArgsSchema } = await import("./daemon/schemas.js");
  const validation = AddAccountArgsSchema.safeParse({
    name, color: flags.color || undefined, provider: flags.provider || undefined,
  });
  if (!validation.success) {
    for (const issue of validation.error.issues) console.error(`Invalid ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const { setupAccount, addShellAlias, CATPPUCCIN_COLORS } = await import("./services/account-manager.js");
  const dir = flags.dir ?? `~/.claude-${name}`;
  const color = flags.color ?? CATPPUCCIN_COLORS[0].hex;
  const label = flags.label ?? name.charAt(0).toUpperCase() + name.slice(1);
  try {
    const { tokenPath } = await setupAccount({
      name, configDir: dir, color, label, provider: validation.data.provider ?? "claude-code",
    });
    console.log(`Account '${name}' created.\n  Config dir: ${dir}\n  Token: ${tokenPath}`);
    const aliasResult = await addShellAlias(name, dir);
    if (aliasResult.modified) console.log("  Shell alias added to .zshrc");
  } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
}

async function handleRemove(name: string | undefined, flags: CliContext["flags"]) {
  if (!name) { console.error("Usage: actl remove <name>"); process.exit(1); }
  const { teardownAccount } = await import("./services/account-manager.js");
  try {
    await teardownAccount(name, { purge: flags.purge });
    console.log(`Account '${name}' removed.${flags.purge ? " Config directory purged." : ""}`);
  } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
}

async function handleRotateToken(name: string | undefined) {
  if (!name) { console.error("Usage: actl rotate-token <name>"); process.exit(1); }
  const { rotateToken } = await import("./services/account-manager.js");
  try {
    const { tokenPath } = await rotateToken(name);
    console.log(`Token rotated for account '${name}'.\n  New token: ${tokenPath}`);
  } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
}

async function handleAuth(subcommand: string | undefined, input: string[], flags: CliContext["flags"]) {
  if (subcommand === "set") {
    const accountName = input[2], token = input[3];
    if (!accountName || !token) {
      console.error("Usage: actl auth set <account> <oauth-refresh-token>\n       actl auth set <account> --api-key <key>");
      process.exit(1);
    }
    const { setAuth } = await import("./services/auth-store.js");
    try {
      if (flags.apiKey) {
        await setAuth(accountName, { type: "api", apiKey: token });
        console.log(`API key stored for account '${accountName}'.`);
      } else {
        await setAuth(accountName, { type: "oauth", accessToken: "", refreshToken: token, expiresAt: 0 });
        console.log(`OAuth refresh token stored for account '${accountName}'.\nAccess token will be obtained automatically on first API call.`);
      }
    } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
  } else if (subcommand === "list") {
    const { listAuth } = await import("./services/auth-store.js");
    const auths = await listAuth();
    const entries = Object.entries(auths);
    if (entries.length === 0) { console.log("No stored credentials. Use: actl auth set <account> <token>"); return; }
    for (const [name, creds] of entries) {
      const status = creds.type === "oauth"
        ? `oauth (expires ${creds.expiresAt > Date.now() ? "in " + Math.round((creds.expiresAt - Date.now()) / 60000) + "m" : "expired — will auto-refresh"})`
        : "api-key";
      console.log(`  ${name}: ${status}`);
    }
  } else if (subcommand === "remove") {
    const accountName = input[2];
    if (!accountName) { console.error("Usage: actl auth remove <account>"); process.exit(1); }
    const { removeAuth } = await import("./services/auth-store.js");
    const removed = await removeAuth(accountName);
    console.log(removed ? `Credentials removed for '${accountName}'.` : `No credentials found for '${accountName}'.`);
  }
}

async function handleLaunch(name: string | undefined, input: string[], flags: CliContext["flags"]) {
  if (!name) { console.error("Usage: actl launch <name> [dir]"); process.exit(1); }
  const dir = input[2];
  const { LaunchDirSchema } = await import("./daemon/schemas.js");
  const validation = LaunchDirSchema.safeParse({ dir });
  if (!validation.success) {
    for (const issue of validation.error.issues) console.error(`Invalid ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const { launchCommand } = await import("./services/cli-commands.js");
  try {
    const result = await launchCommand(name, validation.data.dir, {
      resume: flags.resume, noWindow: flags.noWindow, bypassPermissions: flags.bypassPermissions, noEntire: flags.noEntire,
    });
    console.log(result);
  } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
}

async function handleFind(pattern: string | undefined) {
  if (!pattern) { console.error("Usage: actl find <pattern>"); process.exit(1); }
  const { SearchPatternSchema } = await import("./daemon/schemas.js");
  const validation = SearchPatternSchema.safeParse({ pattern });
  if (!validation.success) {
    for (const issue of validation.error.issues) console.error(`Invalid ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const { findCommand } = await import("./services/cli-commands.js");
  console.log(await findCommand(validation.data.pattern));
}

