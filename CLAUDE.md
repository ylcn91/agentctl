# agentctl

Multi-account AI agent manager — TUI dashboard, inter-agent messaging, task handoff, MCP bridge.

## Commands

```bash
bun install && bun link       # install deps + register `actl` CLI globally
bun test                      # run all 60+ test files
bun test test/<name>.test.ts  # run a single test file
actl                          # launch TUI dashboard
actl daemon start             # start Unix socket daemon (required for messaging/handoff)
actl bridge --account <name>  # start MCP bridge for an account
```

## Bun

- Use `bun` everywhere — not node, npm, npx, jest, vite, or webpack
- Use `Bun.file()` over node:fs readFile/writeFile
- Bun auto-loads .env — don't use dotenv
- Tests use `import { test, expect } from "bun:test"`

## Architecture

CLI (meow) → TUI (Ink/React) → Services → Daemon (Unix socket) → MCP bridge

Key directories:
- `src/cli.tsx` — CLI entry point & command router
- `src/app.tsx` — TUI root (Ink)
- `src/components/` — Dashboard, TaskBoard, MessageInbox, SLABoard, etc.
- `src/daemon/` — Unix socket server, state, framing, workspace-manager
- `src/mcp/` — MCP bridge + 21 tool registrations
- `src/services/` — Business logic (account-manager, tasks, handoff, sla, workflows, etc.)
- `src/providers/` — claude-code, codex-cli, openhands, gemini-cli
- `src/terminals/` — WezTerm, iTerm2, GNOME, Windows Terminal
- `src/types.ts` — Shared types, constants, path re-exports
- `test/` — All test files (flat, named `<module>.test.ts`)

## Code Patterns

- **File store**: `src/services/file-store.ts` provides `atomicWrite`/`atomicRead` with advisory locking — use for all JSON persistence
- **Config**: `src/config.ts` validates with Zod schemas, uses `loadConfig()`/`saveConfig()` — never read config JSON directly
- **Daemon protocol**: Newline-delimited JSON over Unix socket. First message must be `auth` with account+token. See `src/daemon/framing.ts`
- **Feature flags**: Gated via `config.features?.flagName` (see `FeatureFlags` in types.ts). Check before using: workspace, autoAcceptance, capabilityRouting, slaEngine, workflow, retro, etc.
- **Paths**: All file paths computed in `src/paths.ts`. Override base dir with `AGENTCTL_DIR` env var
- **Task lifecycle**: `todo → in_progress → ready_for_review → accepted/rejected`. Enforced transitions in `src/services/tasks.ts`

## Testing

- Tests are in `test/` (flat directory, not nested under src)
- Tests mock file I/O and daemon connections — no real filesystem or socket needed
- Use `import { test, expect, describe, beforeEach, mock } from "bun:test"`
- Mock pattern: `mock.module("../src/services/file-store", () => ({ atomicRead: ..., atomicWrite: ... }))`

## Gotchas

- CLI help text still says `ch` in places (old name: agentctl) — the binary is `actl`/`agentctl`
- `execa` is a dependency used only in `src/poc.tsx` — prefer `Bun.$` for new shell commands
- Config lives at `~/.agentctl/config.json`, socket at `~/.agentctl/hub.sock`
- Account tokens are per-file at `~/.agentctl/tokens/<name>.token` — verified with `timingSafeEqual`
