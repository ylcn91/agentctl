# agentctl: Existing Feature Inventory

> Comprehensive audit of every feature currently implemented in the agentctl codebase.
> Organized by architectural layer with file-level references.

---

## 1. CLI & TUI Layer

### CLI Entry Point (`src/cli.tsx`)
- Command router via meow: `dashboard`, `daemon start/stop/status`, `bridge`, `task`, `message`, `handoff`, `workflow`, `retro`, `config`, `accounts`, `search`, `sessions`, `incident-replay`
- Binary names: `actl` and `agentctl`

### TUI Dashboard (`src/app.tsx`, `src/components/`)
- **Dashboard.tsx** — Main dashboard with account status, real-time stats
- **TaskBoard.tsx** — Task management view (list, filter, status)
- **MessageInbox.tsx** — Inter-agent message viewer
- **SLABoard.tsx** — SLA monitoring with color-coded breach indicators
- **AccountManager.tsx** — Account CRUD interface
- **WorkflowBoard.tsx** — Workflow visualization
- **HealthDashboard.tsx** — Agent health monitoring
- **HandoffTemplates.tsx** — Smart handoff template library
- **SessionManager.tsx** — Live session viewer with naming
- **IncidentReplay.tsx** — Post-mortem incident replay
- **QuickSearch.tsx** — Fuzzy search across tasks, messages, accounts

---

## 2. Daemon Layer (`src/daemon/`)

### Unix Socket Server (`src/daemon/server.ts`)
- Newline-delimited JSON protocol over Unix socket (`~/.agentctl/hub.sock`)
- First message must be `auth` with account name + token
- Handles: `message`, `handoff`, `task_*`, `workspace_*`, `workflow_*`, `retro_*`, `activity_*`, `external_link_*`, `capability_*`, `session_*`, `shared_session_*`, `health_*`, `search`, `subscribe`
- SLA timer runs every 60 seconds checking task age thresholds

### Daemon State (`src/daemon/state.ts`)
- Central state object holding all stores:
  - `MessageStore`, `WorkspaceStore`, `WorkspaceManager`
  - `CapabilityStore`, `KnowledgeStore`, `ExternalLinkStore`
  - `ActivityStore`, `WorkflowStore`, `WorkflowEngine`
  - `RetroStore`, `RetroEngine`, `SessionStore`
  - `SharedSessionManager`, `HealthMonitor`
- Connected account tracking with token verification
- Message persistence with optional external notification hooks

### Protocol Framing (`src/daemon/framing.ts`)
- Newline-delimited JSON frame encoding/decoding
- Buffer management for streaming socket data

### Health Monitor (`src/daemon/health-monitor.ts`)
- Tracks per-account: `active`, `idle`, `disconnected`, `error` states
- Last-active timestamps
- Uptime calculation

### Session Store (`src/daemon/session-store.ts`)
- SQLite-backed session tracking
- Session naming, tagging, lifecycle management

### Shared Session Manager (`src/daemon/shared-session.ts`)
- Live session sharing between agents
- Token-gated access for session viewing

---

## 3. Service Layer (`src/services/`)

### Task Management (`src/services/tasks.ts`)
- **Task lifecycle**: `todo` → `in_progress` → `ready_for_review` → `accepted` / `rejected`
- Enforced state transitions (can't skip states)
- Task events with timestamps for audit
- Task board persistence via file-store
- Task fields: `id`, `title`, `description`, `assignee`, `status`, `priority`, `tags`, `events`, `createdAt`, `updatedAt`

### Handoff System (`src/services/handoff.ts`)
- **HandoffPayload interface**:
  ```typescript
  {
    goal: string
    acceptance_criteria: string[]
    run_commands: string[]
    blocked_by: string[]
    branch?: string
    notes?: string
    project_dir?: string
  }
  ```
- Handoff contract creation and persistence
- Template-based handoff creation (`src/services/handoff-templates.ts`)
- Smart templates with variable interpolation
- Context carry-over between handoffs (auto-attaches previous context)

### Capability Scoring (`src/services/account-capabilities.ts`)
- Weighted scoring formula: **skill match (40) + success rate (30) + speed (20) + recency (10)** = 100 total
- `suggestAssignee()` returns ranked list of agents for a task
- Provider-type awareness (maps accounts to CLI providers)

### Workload Metrics (`src/services/workload-metrics.ts`)
- `WorkloadSnapshot`: WIP count, open count, recent throughput (1-hour window)
- `computeWorkloadModifier()`: WIP penalty (-5/task, max -15) + open penalty (-2/task, max -10) + throughput bonus (+5/task, max +15)
- Feeds into capability scoring as a dynamic modifier

### SLA Engine (`src/services/sla-engine.ts`)
- Configurable thresholds per task status:
  - `in_progress` > 30 minutes → warning
  - `in_progress` > 60 minutes → breach
  - `ready_for_review` > 15 minutes → warning
  - `todo` unassigned > 10 minutes → warning
- OS notification on breach via `node-notifier`
- Periodic check via daemon timer (60-second interval)
- **Current limitation**: notification only, no automated response

### Auto-Acceptance (`src/services/auto-acceptance.ts`)
- Runs `run_commands` from handoff contract in the workspace directory
- Evaluates results: pass/fail per command, overall pass/fail summary
- Timeout support (default 60s per command)
- **Binary**: either auto-acceptance is ON or OFF (feature flag)

### Workflow Engine (`src/services/workflow-engine.ts`)
- YAML-based workflow definitions
- Step scheduling with dependencies (`depends_on`)
- Conditional step execution
- Step statuses: `pending`, `running`, `completed`, `failed`, `skipped`
- Auto-triggers retro engine on workflow completion

### Workflow Store (`src/services/workflow-store.ts`)
- SQLite-backed workflow persistence
- CRUD operations for workflow definitions and instances

### Retro Engine (`src/services/retro-engine.ts`)
- Post-workflow retrospective analysis
- Multi-agent "retro council" — multiple perspectives on completed work
- Generates insights, lessons learned, improvement suggestions
- Wired into workflow engine: auto-triggers on workflow completion

### Retro Store (`src/services/retro-store.ts`)
- SQLite-backed retrospective persistence

### Knowledge Store (`src/daemon/knowledge-store.ts`)
- SQLite-backed knowledge persistence
- Stores learnings from retros
- Searchable knowledge base
- **Current limitation**: knowledge doesn't feed back into capability routing

### Activity Store (`src/services/activity-store.ts`)
- SQLite-backed activity event log
- Records: task events, handoff events, workflow events, message events
- Queryable by account, time range, event type
- **Current limitation**: events are not standardized taxonomy

### File Store (`src/services/file-store.ts`)
- Atomic read/write with advisory locking for JSON persistence
- Used by task board, config, and other JSON-based stores

### Account Manager (`src/services/account-manager.ts`)
- Account CRUD (add, remove, list, update)
- Per-account configuration (provider type, capabilities, settings)
- Token management at `~/.agentctl/tokens/<name>.token`

### External Links (`src/services/external-links.ts`)
- Track external references (PRs, issues, docs) associated with tasks/handoffs

### Analytics (`src/services/analytics.ts`)
- Basic analytics: task throughput, SLA compliance rates, agent utilization

### Search (`src/services/search.ts`)
- Quick search across tasks, messages, accounts, workflows
- Fuzzy matching support

---

## 4. MCP Bridge (`src/mcp/`)

### Bridge (`src/mcp/bridge.ts`)
- MCP server exposing 21 tools to AI agents
- Connects to the daemon via Unix socket
- Tool registration and request routing

### 21 Registered MCP Tools (`src/mcp/tools.ts`)

| # | Tool | Description |
|---|------|-------------|
| 1 | `send_message` | Send a message from one agent to another |
| 2 | `get_messages` | Retrieve messages for an account |
| 3 | `handoff_task` | Create a handoff contract and assign a task |
| 4 | `get_handoff` | Retrieve handoff details |
| 5 | `list_tasks` | List all tasks on the board |
| 6 | `update_task` | Update task status/fields |
| 7 | `create_task` | Create a new task |
| 8 | `suggest_assignee` | Get ranked agent suggestions for a task |
| 9 | `create_workspace` | Create a git worktree workspace for a task |
| 10 | `get_workspace` | Get workspace details |
| 11 | `list_accounts` | List all registered accounts |
| 12 | `register_capabilities` | Register an agent's capabilities |
| 13 | `get_capabilities` | Get an agent's capability profile |
| 14 | `store_knowledge` | Store a learning/insight in the knowledge base |
| 15 | `search_knowledge` | Search the knowledge base |
| 16 | `log_activity` | Log an activity event |
| 17 | `start_workflow` | Start a workflow instance |
| 18 | `get_workflow_status` | Get workflow instance status |
| 19 | `create_external_link` | Associate an external link with a task |
| 20 | `trigger_retro` | Manually trigger a retrospective |
| 21 | `search` | Cross-entity search |

---

## 5. Provider Layer (`src/providers/`)

### Provider Registry (`src/providers/registry.ts`)
- Pluggable provider architecture via `AgentProvider` interface
- `createDefaultRegistry()` registers all 6 providers

### 6 Registered Providers

| Provider | File | CLI Tool |
|----------|------|----------|
| `claude-code` | `src/providers/claude-code.ts` | Claude Code CLI |
| `codex-cli` | `src/providers/codex-cli.ts` | OpenAI Codex CLI |
| `openhands` | `src/providers/openhands.ts` | OpenHands |
| `gemini-cli` | `src/providers/gemini-cli.ts` | Gemini CLI |
| `opencode` | `src/providers/opencode.ts` | OpenCode |
| `cursor-agent` | `src/providers/cursor-agent.ts` | Cursor Agent |

### Provider Interface (`src/providers/types.ts`)
```typescript
interface AgentProvider {
  id: string
  name: string
  icon: string
  launchCommand(account: AccountConfig): string[]
  healthCheck(account: AccountConfig): Promise<boolean>
  getCapabilities(): string[]
}
```

---

## 6. Workspace Isolation (`src/services/workspace.ts`, `src/daemon/workspace-manager.ts`)

- Git worktree-based workspace isolation per task
- Workspace lifecycle: `preparing` → `ready` → `cleaning` → (removed)
- Branch name validation (prevents path traversal, unsafe characters)
- Stale workspace recovery on daemon restart
- Workspace linked to handoff ID and owner account

---

## 7. Configuration (`src/config.ts`)

### Config Schema (Zod-validated)
- Config file: `~/.agentctl/config.json`
- `loadConfig()` / `saveConfig()` with validation
- Hot-reload support (watches for config file changes)

### Feature Flags
```typescript
interface FeatureFlags {
  workspace?: boolean
  autoAcceptance?: boolean
  capabilityRouting?: boolean
  slaEngine?: boolean
  workflow?: boolean
  retro?: boolean
  externalLinks?: boolean
  council?: boolean
}
```

---

## 8. Paths (`src/paths.ts`)

- All file paths computed centrally
- Override base directory with `AGENTCTL_DIR` env var
- Default base: `~/.agentctl/`
- Paths for: config, socket, tokens, databases (knowledge, activity, workflow, retro, sessions)

---

## 9. Testing (`test/`)

- 60+ test files in flat `test/` directory
- Uses `bun:test` (describe, test, expect, beforeEach, mock)
- Tests mock file I/O and daemon connections (no real filesystem/socket)
- Mock pattern: `mock.module("../src/services/file-store", () => ({ ... }))`

---

## 10. Feature Summary Matrix

| Feature | Status | Key Files |
|---------|--------|-----------|
| Multi-account management | Implemented | `account-manager.ts`, `config.ts` |
| Inter-agent messaging | Implemented | `state.ts`, `message-store.ts` |
| Task board with lifecycle | Implemented | `tasks.ts` |
| Handoff contracts | Implemented | `handoff.ts`, `handoff-templates.ts` |
| Capability-based routing | Implemented | `account-capabilities.ts` |
| Workload-aware scoring | Implemented | `workload-metrics.ts` |
| SLA monitoring (notify) | Implemented | `sla-engine.ts` |
| Auto-acceptance testing | Implemented | `auto-acceptance.ts` |
| Workflow orchestration | Implemented | `workflow-engine.ts`, `workflow-store.ts` |
| Post-workflow retrospectives | Implemented | `retro-engine.ts`, `retro-store.ts` |
| Knowledge base | Implemented | `knowledge-store.ts` |
| Activity logging | Implemented | `activity-store.ts` |
| Git worktree isolation | Implemented | `workspace.ts`, `workspace-manager.ts` |
| MCP bridge (21 tools) | Implemented | `bridge.ts`, `tools.ts` |
| 6 CLI providers | Implemented | `providers/` |
| TUI dashboard | Implemented | `components/` |
| Health monitoring | Implemented | `health-monitor.ts` |
| Live session sharing | Implemented | `shared-session.ts` |
| Quick search | Implemented | `search.ts` |
| Incident replay | Implemented | `IncidentReplay.tsx` |
| Config hot-reload | Implemented | `config.ts` |
| Context carry-over | Implemented | `handoff.ts` |
