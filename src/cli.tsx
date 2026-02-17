#!/usr/bin/env bun
import meow from "meow";

const cli = meow(
  `
  Usage
    $ actl                    Open TUI dashboard
    $ actl add <name>         Add new account
    $ actl remove <name>      Remove account
    $ actl rotate-token <name> Rotate account token
    $ actl daemon start       Start hub daemon
    $ actl daemon stop        Stop hub daemon
    $ actl daemon status      Show daemon status
    $ actl bridge --account   MCP bridge (internal)
    $ actl launch <name> [dir]  Quick-launch account
    $ actl config set <key> <value>  Set config value
    $ actl status             Show account status
    $ actl usage              Show usage table
    $ actl list               List accounts
    $ actl replay <session-id> Replay entire.io checkpoint
    $ actl tdd <test-file>    Start TDD workflow session

  Options
    --account  Account name (for bridge mode)
    --dir      Config directory (for add)
    --color    Hex color (for add)
    --label    Display label (for add)
    --purge    Remove config directory (for remove)
    --resume   Resume last session (for launch)
    --no-window  Print command instead of opening WezTerm (for launch)
    --bypass-permissions  Skip permission checks (for launch)
    --no-entire  Skip auto-enabling entire (for launch)
    --provider  Provider type (claude-code, codex-cli, openhands, gemini-cli, opencode, cursor-agent)
    --api-key   Store as API key instead of OAuth token (for auth set)
`,
  {
    importMeta: import.meta,
    autoHelp: false,
    flags: {
      help: { type: "boolean", default: false },
      account: { type: "string" },
      dir: { type: "string" },
      color: { type: "string" },
      label: { type: "string" },
      purge: { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      noWindow: { type: "boolean", default: false },
      bypassPermissions: { type: "boolean", default: false },
      noEntire: { type: "boolean", default: false },
      provider: { type: "string" },
      json: { type: "boolean", default: false },
      search: { type: "string" },
      watch: { type: "boolean", default: false },
      apiKey: { type: "boolean", default: false },
    },
  }
);

if (cli.flags.help) {
  const { showHelp } = await import("./services/help.js");
  console.log(showHelp());
  process.exit(0);
}

const [command, subcommand] = cli.input;

const { routeCommand } = await import("./cli-router.js");
await routeCommand({ command, subcommand, input: cli.input, flags: cli.flags });
