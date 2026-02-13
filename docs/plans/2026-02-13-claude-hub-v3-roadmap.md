# Claude Hub v3 Roadmap

**Date:** 2026-02-13
**Status:** Draft
**Scope:** 8 features across P0/P1/P2 priorities

---

## Dependency Graph

```
Feature 1 (Multi-provider e2e)
   |
   +---> Feature 4 (TaskBoard account-aware) -- depends on provider selection wiring
   +---> Feature 7 (Cross-platform terminals) -- depends on provider abstraction
   +---> Feature 8 (Use-case extraction) -- cleaner after provider plumbing settles

Feature 2 (Daemon protocol hardening)
   |
   +---> Feature 3 (SQLite persistence) -- needs stable framing before persisting
   +---> Feature 5 (Notifications) -- hooks into daemon events post-hardening

Feature 6 (Entire integration) -- independent, can start anytime
```

**Recommended execution order:**

1. Feature 2 (protocol hardening) -- unblocks 3 and 5
2. Feature 1 (multi-provider) -- unblocks 4, 7, 8
3. Feature 3 (SQLite persistence) -- after 2
4. Feature 4 (TaskBoard) -- after 1
5. Feature 5 (notifications) -- after 2
6. Feature 6 (Entire) -- anytime
7. Feature 7 (cross-platform terminals) -- after 1
8. Feature 8 (use-case extraction) -- last, after 1

---

## P0 -- Must-have (enables core functionality)

### Feature 1: Multi-provider end-to-end flow

**Priority:** P0

**Problem statement:**
The `ProviderRegistry` (`src/providers/registry.ts`) supports four providers (claude-code, codex-cli, openhands, gemini-cli) with a clean `AgentProvider` interface (`src/providers/types.ts:73-99`). However, every consumer bypasses the registry and hardcodes `ClaudeCodeProvider`:

- `src/components/Dashboard.tsx:4` -- `import { ClaudeCodeProvider }` with `const provider = new ClaudeCodeProvider()` at line 11
- `src/components/Launcher.tsx:5` -- identical hardcoded import, instantiated at line 12
- `src/components/UsageDetail.tsx:4` -- same pattern at line 9
- `src/services/cli-commands.ts:4` -- `import { ClaudeCodeProvider }`, instantiated at line 9
- `src/services/account-manager.ts:87` -- `provider: "claude-code"` hardcoded in `setupAccount()`

The `ch add` command creates accounts with `provider: "claude-code"` regardless of user intent. The `AccountConfig` type (`src/types.ts:16`) has a `provider: ProviderId` field that is never consulted at launch, stats, or quota time.

**Proposed solution:**
1. Add a `--provider` flag to `ch add` (CLI and `AddAccount` component), defaulting to `"claude-code"`.
2. Create a shared singleton registry instance (e.g., `src/providers/index.ts`) that components import instead of raw providers.
3. Replace all `new ClaudeCodeProvider()` call sites with `registry.getOrDefault(account.provider)`.
4. Pass `provider` through the launch, stats, and quota pipelines so each account resolves its own provider.

**Files to create/modify:**
- `src/providers/index.ts` (new -- singleton registry export)
- `src/components/Dashboard.tsx` (replace hardcoded provider)
- `src/components/Launcher.tsx` (replace hardcoded provider)
- `src/components/UsageDetail.tsx` (replace hardcoded provider)
- `src/services/cli-commands.ts` (replace hardcoded provider)
- `src/services/account-manager.ts` (accept provider param in `setupAccount`)

**Dependencies:** None (foundational)

**Acceptance criteria:**
1. `ch add my-codex --provider codex-cli` creates an account with `provider: "codex-cli"` in config.json
2. Dashboard, Launcher, and UsageDetail resolve the provider from each account's config rather than importing ClaudeCodeProvider directly
3. `ch launch <account>` builds the correct launch command for the account's provider (e.g., `codex` instead of `claude`)
4. Stats and quota calls delegate to the provider specified in the account config
5. Existing accounts with `provider: "claude-code"` continue to work without migration

---

### Feature 2: Daemon protocol hardening (framing + requestId)

**Priority:** P0

**Problem statement:**
The daemon communicates over a Unix socket using raw `JSON.parse(data.toString())` with no message framing. This creates three failure modes:

- `src/daemon/server.ts:62` -- `JSON.parse(data.toString())` on raw socket data; TCP can deliver partial or concatenated chunks, so a large message or burst will produce invalid JSON
- `src/mcp/bridge.ts:21` -- `socket.once("data", ...)` assumes the entire response arrives in a single data event; a split response causes silent failure
- `src/services/daemon-client.ts:52` -- same `JSON.parse(data.toString())` on a single data event

Additionally, there is no request/response correlation. The bridge (`src/mcp/bridge.ts:18-24`) uses `socket.once("data", ...)` which means a second in-flight request will steal the first request's response handler. The daemon has no timeout or acknowledgement mechanism -- a lost message is silently dropped.

**Proposed solution:**
1. Adopt newline-delimited JSON (NDJSON) framing: each message is a single JSON object terminated by `\n`. Parse incoming data by buffering until `\n` and splitting on it.
2. Add a `requestId` field to every request; the daemon echoes it back in the response. Clients correlate responses by `requestId`.
3. Add a request timeout (default 5s) in the client; emit an error if no matching response arrives.
4. Extract the line-based parser into a shared `src/daemon/framing.ts` module used by server, bridge, and client.

**Files to create/modify:**
- `src/daemon/framing.ts` (new -- NDJSON line parser + requestId generator)
- `src/daemon/server.ts` (use framing parser on socket data, echo requestId)
- `src/mcp/bridge.ts` (use framing parser, correlate by requestId, add timeout)
- `src/services/daemon-client.ts` (use framing parser, correlate by requestId)
- `tests/daemon-framing.test.ts` (new -- unit tests for framing edge cases)

**Dependencies:** None (foundational)

**Acceptance criteria:**
1. Messages larger than one TCP segment are correctly reassembled (buffered until `\n`)
2. Concurrent requests from the MCP bridge return the correct response to each caller (verified by requestId correlation)
3. A request that receives no response within 5 seconds rejects with a timeout error
4. The daemon and all clients (bridge, daemon-client) use the shared framing module
5. Existing auth handshake protocol continues to work with the new framing

---

## P1 -- High value (improves reliability/usability)

### Feature 3: SQLite message persistence

**Priority:** P1

**Problem statement:**
All inter-account messages are stored in an in-memory array (`src/daemon/state.ts:14` -- `private messages: Message[] = []`). A daemon restart loses every message. Only handoff-type messages get persisted to disk as individual JSON files (`src/daemon/server.ts:43-50`), but they are never reloaded at startup. There is no message history, no search, and no way to archive old messages.

**Proposed solution:**
1. Create a SQLite-backed message store using `bun:sqlite` (per CLAUDE.md guidelines).
2. Store the database at `~/.claude-hub/messages.db` with a `messages` table containing all fields from the `Message` interface plus `read` status.
3. Replace `DaemonState.messages` array with queries to the SQLite store.
4. Load message history on daemon startup; support pagination for `read_messages`.
5. Add an `archive` operation that soft-deletes old messages (older than 7 days by default).

**Files to create/modify:**
- `src/daemon/message-store.ts` (new -- SQLite message CRUD)
- `src/daemon/state.ts` (replace in-memory array with message-store calls)
- `src/daemon/server.ts` (initialize DB on startup, remove JSON file persistence for handoffs)
- `src/mcp/tools.ts` (add optional `limit`/`offset` params to `read_messages`)

**Dependencies:** Feature 2 (protocol hardening should land first so the persistence layer operates on a stable protocol)

**Acceptance criteria:**
1. Messages survive daemon restart and are available via `read_messages` after reboot
2. Database is created at `~/.claude-hub/messages.db` using `bun:sqlite`
3. Per-message read/unread status is tracked (not bulk mark-all-read only)
4. `read_messages` supports `limit` and `offset` parameters for pagination
5. Messages older than 7 days are archivable via a `archive_messages` tool or CLI command

---

### Feature 4: TaskBoard account-aware assignment

**Priority:** P1

**Problem statement:**
The `TaskBoard` component accepts an `accounts` prop (`src/components/TaskBoard.tsx:17` -- `accounts?: string[]`) which drives the assignment picker (line 82-96). However, the `App` component never passes this prop (`src/app.tsx:38` -- `<TaskBoard onNavigate={setView} />`), so `accounts` defaults to `[]` and the assign feature is silently disabled.

Beyond the wiring gap, tasks have no due date, no priority level, and no tags. There is also no synchronization between TaskBoard tasks and daemon handoffs -- a handoff received via the daemon does not appear as a task.

**Proposed solution:**
1. Wire accounts from config into `App` and pass `accounts={accountNames}` to `TaskBoard`.
2. Extend the `Task` interface in `src/services/tasks.ts` with `priority`, `dueDate`, and `tags` fields.
3. Add a handoff-to-task sync: when a handoff message is received, auto-create a task on the board.
4. Display priority and due date in the TaskBoard UI; allow sorting by priority.

**Files to create/modify:**
- `src/app.tsx` (load config, pass account names to TaskBoard)
- `src/services/tasks.ts` (extend Task interface with priority/dueDate/tags)
- `src/components/TaskBoard.tsx` (render new fields, add sort-by-priority)
- `src/daemon/state.ts` or `src/daemon/server.ts` (emit event on handoff for task sync)

**Dependencies:** Feature 1 (account list should be provider-aware before wiring into TaskBoard)

**Acceptance criteria:**
1. `<TaskBoard>` receives the list of account names from `App` and the assign picker works
2. Tasks support `priority` (P0/P1/P2), `dueDate` (ISO string), and `tags` (string array)
3. Receiving a handoff via the daemon auto-creates a "pending" task on the board
4. TaskBoard can sort by priority (P0 first)
5. Existing tasks without the new fields load without errors (backwards compatible)

---

### Feature 5: Activate notifications

**Priority:** P1

**Problem statement:**
The notification service (`src/services/notifications.ts`) is fully implemented with macOS native notifications for rate limits, handoffs, and messages. It exports `notifyRateLimit`, `notifyHandoff`, and `notifyMessage` functions. However, there are zero call sites in the codebase -- the service is dead code.

**Proposed solution:**
1. Hook `notifyHandoff` into the daemon's handoff message handler (`src/daemon/server.ts:106-123`).
2. Hook `notifyMessage` into the daemon's message handler (`src/daemon/server.ts:81-89`).
3. Hook `notifyRateLimit` into quota estimation when threshold is crossed (Dashboard refresh cycle).
4. Add per-account mute rules to the notification config (e.g., mute messages from specific accounts).
5. Store notification preferences in `~/.claude-hub/config.json` under a `notifications` key.

**Files to create/modify:**
- `src/daemon/server.ts` (call notify functions on handoff/message events)
- `src/components/Dashboard.tsx` (call notifyRateLimit when quota exceeds threshold)
- `src/services/notifications.ts` (add mute-list support, load config from disk)
- `src/types.ts` (add `notifications` field to `HubConfig`)

**Dependencies:** Feature 2 (daemon protocol should be stable before adding notification side-effects)

**Acceptance criteria:**
1. Receiving a handoff via the daemon triggers a macOS notification
2. Receiving a message via the daemon triggers a macOS notification
3. Crossing a rate-limit threshold (e.g., 80%) on dashboard refresh triggers a notification
4. Per-account mute rules suppress notifications from specified senders
5. Notifications can be globally disabled via `config.json` `notifications.enabled: false`

---

## P2 -- Nice-to-have (future-proofing)

### Feature 6: Entire integration deepening

**Priority:** P2

**Problem statement:**
The CLI fallback for reading checkpoints returns empty data (`src/services/entire.ts:88` -- `readCheckpointsFromCLI` runs `entire explain --short --no-pager` but always returns `[]`). The git-based reader works but provides limited context -- there is no way to view diffs, get human-readable explanations, or safely roll back to a checkpoint from within Claude Hub.

**Proposed solution:**
1. Parse `entire explain` output in `readCheckpointsFromCLI` to extract checkpoint summaries.
2. Add an `entire diff <checkpointId>` integration that returns a diff preview.
3. Add a checkpoint timeline view component showing checkpoint history with branch context.
4. Add a safe rollback flow that calls `entire resume <id>` with a confirmation step.

**Files to create/modify:**
- `src/services/entire.ts` (implement CLI output parsing, add diff/explain wrappers)
- `src/components/EntireTimeline.tsx` (new -- checkpoint timeline view)
- `src/components/Launcher.tsx` (link to timeline from checkpoint picker)

**Dependencies:** None (independent of other features)

**Acceptance criteria:**
1. `readCheckpointsFromCLI` parses `entire explain` output and returns populated `EntireCheckpoint` objects
2. A diff preview is available for each checkpoint via `entire diff`
3. The timeline view renders checkpoints with timestamps, branches, and file counts
4. Rollback requires explicit confirmation before calling `entire resume`

---

### Feature 7: Cross-platform terminal profiles

**Priority:** P2

**Problem statement:**
Terminal launching is hardcoded to WezTerm on macOS:

- `src/components/Launcher.tsx:166` -- `await $\`open -a WezTerm -- zsh -c ${shellCmd}\`.quiet()`
- `src/services/cli-commands.ts:149` -- identical `open -a WezTerm` command

Users on iTerm, Alacritty, Gnome Terminal, or Windows Terminal cannot use the "open in new window" feature. There is no abstraction for terminal profiles.

**Proposed solution:**
1. Create a `TerminalProfile` interface with `id`, `displayName`, `platform`, and `buildLaunchCommand(shellCmd: string): string[]`.
2. Implement profiles for WezTerm, iTerm2, Gnome Terminal, and Windows Terminal.
3. Add a `terminal` field to `HubConfig.defaults` and per-account overrides.
4. Replace hardcoded WezTerm calls in Launcher and cli-commands with the selected profile.

**Files to create/modify:**
- `src/terminals/types.ts` (new -- TerminalProfile interface)
- `src/terminals/wezterm.ts` (new -- WezTerm profile)
- `src/terminals/iterm.ts` (new -- iTerm2 profile)
- `src/terminals/registry.ts` (new -- terminal registry)
- `src/components/Launcher.tsx` (use terminal profile)
- `src/services/cli-commands.ts` (use terminal profile)

**Dependencies:** Feature 1 (provider abstraction pattern informs terminal abstraction)

**Acceptance criteria:**
1. `TerminalProfile` interface supports WezTerm, iTerm2, Gnome Terminal, and Windows Terminal
2. `config.json` `defaults.terminal` selects the default terminal; per-account overrides are supported
3. `ch launch` uses the configured terminal profile instead of hardcoded WezTerm
4. Auto-detection: if no terminal is configured, detect installed terminals and pick the first match

---

### Feature 8: Use-case layer extraction

**Priority:** P2

**Problem statement:**
Business logic is embedded directly in React components:

- `src/components/Dashboard.tsx:53` -- `async function load()` contains config loading, stats parsing, quota estimation, entire checkpoint fetching, and unread count fetching (lines 53-115)
- `src/components/UsageDetail.tsx:26` -- `async function load()` duplicates config loading and stats parsing (lines 26-45)
- `src/components/Launcher.tsx:119` -- `async function doLaunch()` contains checkpoint resume, entire enable, command building, and terminal execution (lines 119-173)

This makes the logic untestable without rendering components and creates duplication between Dashboard and UsageDetail.

**Proposed solution:**
1. Create `src/application/use-cases/` directory with pure-logic modules.
2. Extract `loadDashboardData(configPath?)` -- returns accounts with stats, quota, entire status, unread counts.
3. Extract `loadUsageData(configPath?)` -- returns accounts with stats and weekly totals.
4. Extract `launchAccount(accountName, opts)` -- handles entire enable, checkpoint resume, command build, terminal launch.
5. Components become thin view layers calling these use-cases.

**Files to create/modify:**
- `src/application/use-cases/load-dashboard-data.ts` (new)
- `src/application/use-cases/load-usage-data.ts` (new)
- `src/application/use-cases/launch-account.ts` (new)
- `src/components/Dashboard.tsx` (delegate to use-case)
- `src/components/UsageDetail.tsx` (delegate to use-case)
- `src/components/Launcher.tsx` (delegate to use-case)
- `src/services/cli-commands.ts` (delegate to use-case)

**Dependencies:** Feature 1 (provider wiring should settle first to avoid extracting logic that will immediately change)

**Acceptance criteria:**
1. `loadDashboardData()` is a pure async function testable without React
2. `loadUsageData()` eliminates the duplicated stats-loading logic between Dashboard and UsageDetail
3. `launchAccount()` encapsulates the entire launch flow (entire, checkpoint, command, terminal)
4. Components import and call use-case functions; no business logic remains in component `useEffect` callbacks
5. All existing CLI commands (`ch status`, `ch usage`, `ch launch`) continue to work via the extracted use-cases
