#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import meow from "meow";
import { App } from "./app.js";

const cli = meow(
  `
  Usage
    $ ch                    Open TUI dashboard
    $ ch add <name>         Add new account
    $ ch remove <name>      Remove account
    $ ch daemon start       Start hub daemon
    $ ch daemon stop        Stop hub daemon
    $ ch bridge --account   MCP bridge (internal)
    $ ch status             Show account status
    $ ch usage              Show usage table
    $ ch list               List accounts

  Options
    --account  Account name (for bridge mode)
    --dir      Config directory (for add)
    --color    Hex color (for add)
    --label    Display label (for add)
    --purge    Remove config directory (for remove)
`,
  {
    importMeta: import.meta,
    flags: {
      account: { type: "string" },
      dir: { type: "string" },
      color: { type: "string" },
      label: { type: "string" },
      purge: { type: "boolean", default: false },
    },
  }
);

const [command, subcommand] = cli.input;

if (command === "daemon" && subcommand === "start") {
  await import("./daemon/index.js");
} else if (command === "daemon" && subcommand === "stop") {
  const { stopDaemonByPid } = await import("./daemon/server.js");
  stopDaemonByPid();
} else if (command === "add") {
  const name = subcommand;
  if (!name) {
    console.error("Usage: ch add <name>");
    process.exit(1);
  }
  const { setupAccount, addShellAlias, CATPPUCCIN_COLORS } = await import("./services/account-manager.js");
  const dir = cli.flags.dir ?? `~/.claude-${name}`;
  const color = cli.flags.color ?? CATPPUCCIN_COLORS[0].hex;
  const label = cli.flags.label ?? name.charAt(0).toUpperCase() + name.slice(1);
  try {
    const { account, tokenPath } = await setupAccount({
      name, configDir: dir, color, label,
    });
    console.log(`Account '${name}' created.`);
    console.log(`  Config dir: ${dir}`);
    console.log(`  Token: ${tokenPath}`);
    const aliasResult = await addShellAlias(name, dir);
    if (aliasResult.modified) {
      console.log(`  Shell alias added to .zshrc`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "remove") {
  const name = subcommand;
  if (!name) {
    console.error("Usage: ch remove <name>");
    process.exit(1);
  }
  const { teardownAccount } = await import("./services/account-manager.js");
  try {
    await teardownAccount(name, { purge: cli.flags.purge });
    console.log(`Account '${name}' removed.${cli.flags.purge ? " Config directory purged." : ""}`);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
} else if (command === "bridge" && cli.flags.account) {
  // MCP bridge - will be connected when mcp/bridge.ts exists
  console.log(`Bridge mode for account: ${cli.flags.account} (not yet implemented)`);
} else if (command === "status") {
  const { statusCommand } = await import("./services/cli-commands.js");
  console.log(await statusCommand());
} else if (command === "usage") {
  const { usageCommand } = await import("./services/cli-commands.js");
  console.log(await usageCommand());
} else if (command === "list") {
  const { listCommand } = await import("./services/cli-commands.js");
  console.log(await listCommand());
} else {
  // Default: TUI mode
  render(<App />);
}
