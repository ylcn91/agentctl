# New Features: Intelligent Delegation for agentctl

> Features derived from the "Intelligent AI Delegation" paper (Google DeepMind, Feb 2026),
> cross-referenced with llm-council's multi-perspective analysis pattern
> and entire.io CLI's checkpoint/strategy architecture.
> Each feature is grounded in specific paper sections and mapped to agentctl files.

---

## Priority Legend

| Priority | Meaning | Timeframe |
|----------|---------|-----------|
| **P0** | Foundation — everything else depends on this | Week 1 |
| **P1** | Core framework — the paper's main contributions | Week 2-3 |
| **P2** | Safety & resilience — critical for production | Week 3-4 |
| **P3** | Advanced intelligence — differentiating features | Month 2 |
| **P4** | Long-term hardening & interop | Month 3+ |

---

## P0: Foundation Layer

### F-01: Enriched Handoff Contract Schema
**Paper ref**: Section 2.2 (Task Characteristics), Section 4.1 (Task Decomposition)

**What**: Extend `HandoffPayload` with the paper's 11 task characteristic dimensions. All new fields are optional for backward compatibility.

**New fields**:
```typescript
interface HandoffPayload {
  // Existing fields (unchanged)
  goal: string
  acceptance_criteria: string[]
  run_commands: string[]
  blocked_by: string[]
  branch?: string
  notes?: string
  project_dir?: string

  // NEW: Task Characteristics (Paper §2.2)
  complexity?: 'low' | 'medium' | 'high' | 'critical'
  criticality?: 'low' | 'medium' | 'high' | 'critical'
  uncertainty?: 'low' | 'medium' | 'high'
  estimated_duration_minutes?: number
  estimated_cost?: number
  verifiability?: 'auto-testable' | 'needs-review' | 'subjective'
  reversibility?: 'reversible' | 'partial' | 'irreversible'
  contextuality?: 'low' | 'medium' | 'high'
  subjectivity?: 'objective' | 'mixed' | 'subjective'
  required_skills?: string[]
  resource_requirements?: string[]

  // NEW: Delegation Intelligence (Paper §4.2)
  autonomy_level?: 'strict' | 'standard' | 'open-ended'
  monitoring_level?: 'outcome-only' | 'periodic' | 'continuous'
  verification_policy?: VerificationPolicy

  // NEW: Council Pre-analysis (llm-council pattern)
  council_analysis?: CouncilAnalysis
}

interface VerificationPolicy {
  mode: 'auto' | 'strict' | 'human-required'
  artifacts?: { type: string; validator: string }[]
}
```

**Where**: `src/services/handoff.ts`, `src/mcp/tools.ts` (handoff_task tool), `src/types.ts`

**Why**: Every downstream system (routing, SLA, monitoring, autonomy) consumes these dimensions. Without them, all decisions are guesses. This is the single highest-leverage change.

---

### F-02: Standardized Observability Event Taxonomy
**Paper ref**: Section 4.5 (Monitoring)

**What**: Define a formal, typed event taxonomy that all systems emit. Replace ad-hoc activity logging with structured events.

**Event types**:
```typescript
type DelegationEvent =
  | { type: 'TASK_CREATED'; taskId: string; delegator: string; characteristics: TaskCharacteristics }
  | { type: 'TASK_ASSIGNED'; taskId: string; delegator: string; delegatee: string; reason: string }
  | { type: 'TASK_STARTED'; taskId: string; agent: string }
  | { type: 'CHECKPOINT_REACHED'; taskId: string; agent: string; percent: number; step: string }
  | { type: 'RESOURCE_WARNING'; taskId: string; agent: string; warning: string }
  | { type: 'PROGRESS_UPDATE'; taskId: string; agent: string; data: ProgressData }
  | { type: 'SLA_WARNING'; taskId: string; threshold: string; elapsed: number }
  | { type: 'SLA_BREACH'; taskId: string; threshold: string; elapsed: number }
  | { type: 'TASK_COMPLETED'; taskId: string; agent: string; result: 'success' | 'failure' }
  | { type: 'TASK_VERIFIED'; taskId: string; verifier: string; passed: boolean; receipt: VerificationReceipt }
  | { type: 'REASSIGNMENT'; taskId: string; from: string; to: string; trigger: string }
  | { type: 'DELEGATION_CHAIN'; taskId: string; chain: string[] }
  | { type: 'TRUST_UPDATE'; agent: string; delta: number; reason: string }
```

**Where**: New `src/services/event-bus.ts`, extend `src/services/activity-store.ts`, update all emitting services

**Why**: The paper states standardized observability is "critical for interoperability in the agentic web." Without typed events, you can't build adaptive coordination, trust updates, or audit trails.

---

### F-03: Trust & Reputation Store
**Paper ref**: Section 4.6 (Trust and Reputation)

**What**: A separate trust/reputation store distinct from the capability store. Capability answers "can this agent do this?" — trust answers "should I give this agent this task?"

**Data model**:
```typescript
interface AgentReputation {
  accountName: string
  // Outcome metrics
  totalTasksCompleted: number
  totalTasksFailed: number
  totalTasksRejected: number
  completionRate: number        // accepted / (accepted + rejected + failed)
  // SLA metrics
  slaComplianceRate: number     // on-time / total
  averageCompletionMinutes: number
  // Quality metrics
  qualityVariance: number       // consistency measure
  criticalFailureCount: number  // failures on criticality:high+ tasks
  // Behavioral metrics
  progressReportingRate: number // how often the agent reports progress
  // Computed
  trustScore: number            // 0-100, weighted composite
  trustLevel: 'low' | 'medium' | 'high'
  lastUpdated: string
}
```

**Integration points**:
- Retro engine emits `TRUST_UPDATE` events after workflow completion
- Capability scorer reads trust alongside capability score
- Autonomy level derived from trust: low → strict, medium → standard, high → open-ended
- Replaces binary `autoAcceptance` flag with graduated autonomy

**Where**: New `src/daemon/trust-store.ts`, modify `src/services/account-capabilities.ts`, wire into `src/services/retro-engine.ts`

**Why**: The paper's most important structural distinction. Without separating trust from capability, you can't implement graduated autonomy, adaptive monitoring, or intelligent routing.

---

## P1: Core Framework

### F-04: Council Pre-Analysis Service
**Paper ref**: Section 4.1 (iterative decomposition proposals), Section 4.2 (proposal evaluation)
**Inspired by**: llm-council (3-stage pipeline: individual analysis → peer review → chairman synthesis)

**What**: Before delegating a task, run a multi-model analysis pipeline to enrich the handoff contract with objective task characteristics and a recommended approach.

**Three stages**:
1. **Stage 1 — Parallel Analysis**: Multiple LLMs independently analyze the task (via OpenRouter API calls, not heavy CLI processes). Each produces: complexity assessment, approach plan, required skills, duration estimate, recommended provider.
2. **Stage 2 — Anonymized Peer Review**: Each model evaluates the others' analyses (anonymized as "Response A, B, C..."). Produces rankings.
3. **Stage 3 — Chairman Synthesis**: A designated model synthesizes all analyses and rankings into a final enriched contract with recommended approach and best-fit provider.

**Output**: `CouncilAnalysis` object attached to the handoff contract.

**Config**:
```typescript
council?: {
  enabled: boolean
  models: string[]        // OpenRouter model IDs
  chairman: string        // Model for synthesis
  apiKey?: string         // OpenRouter API key (or env OPENROUTER_API_KEY)
  autoAnalyze?: boolean   // Auto-run on every handoff
  minComplexityForAnalysis?: 'low' | 'medium' | 'high'
}
```

**Where**: New `src/services/council.ts`, new MCP tool `analyze_before_handoff`, config extension

**Why**: The paper says "a delegator may need to iteratively generate several proposals for the final decomposition" (§4.1). This IS the llm-council pattern applied to delegation — multiple perspectives before committing.

---

### F-05: Adaptive SLA with Graduated Responses
**Paper ref**: Section 4.4 (Adaptive Coordination)

**What**: Replace notification-only SLA breaches with a graduated response ladder that takes action based on task criticality and severity.

**Response ladder**:

| Condition | Response |
|-----------|----------|
| `in_progress` > 30min | Ping agent via daemon message |
| `in_progress` > 60min | Auto-suggest reassignment via `suggest_assignee` |
| `in_progress` > 60min AND `criticality: critical` | Auto-reassign to next-best agent |
| Agent unresponsive (no heartbeat 10min) | Mark agent degraded, reassign all active tasks |
| 2 consecutive task rejections by same agent | Lower trust score, require human approval for next assignment |
| Progress report shows < 20% at > 50% time | Proactive warning, offer reassignment |

**Cooldown mechanisms** (from §4.4 oscillation warning):
- Minimum 10-minute cooldown between reassignments for same task
- Maximum 3 reassignments before escalation to human
- Reputation damping factor on rapid reassignment sequences

**Where**: Extend `src/services/sla-engine.ts`, new `src/services/adaptive-coordinator.ts`

**Why**: The paper's adaptive coordination cycle (monitor → detect → diagnose → evaluate → respond) is the core improvement over "detect → notify." Currently SLA breaches are informational; they should be actionable.

---

### F-06: Report Progress MCP Tool
**Paper ref**: Section 4.5 (Process-Level Monitoring)

**What**: New MCP tool allowing agents to report intermediate state during task execution.

```typescript
// New MCP tool
report_progress({
  task_id: string,
  percent_complete: number,        // 0-100
  current_step: string,            // "running tests", "implementing feature"
  blockers?: string[],             // "waiting on API response", "test failures"
  estimated_remaining_minutes?: number,
  artifacts_produced?: string[],   // files created/modified so far
})
```

**Integration**: Feeds into SLA engine (proactive breach detection), activity store (event log), TUI dashboard (live progress).

**Where**: New tool in `src/mcp/tools.ts`, extend daemon protocol, update `SLABoard.tsx`

**Why**: Without process monitoring, you can't distinguish between a stuck agent and a slow one. Progress reports enable proactive re-delegation before SLA breach, not after.

---

### F-07: Contract-First Task Decomposition
**Paper ref**: Section 4.1 (Contract-First Decomposition)

**What**: A decomposition service that takes a high-level objective, evaluates verifiability of the outcome, and either produces sub-tasks with enriched contracts or flags for human decomposition.

**Logic**:
```
Objective arrives →
  Evaluate verifiability (can the outcome be auto-tested?)
    → If auto-testable: create enriched handoff contract
    → If needs-review: create handoff + flag for human verification
    → If subjective: recursively decompose into smaller, verifiable sub-tasks
    → If still not verifiable after decomposition: halt and request human input
```

**New MCP tool**: `decompose_task({ goal, context, max_depth })`

**Where**: New `src/services/task-decomposer.ts`, new MCP tool, integrates with council service for analysis

**Why**: The paper's "contract-first decomposition" principle — "task delegation is contingent upon the outcome having precise verification" — is its most novel architectural contribution.

---

### F-08: Provider-Aware Capability Routing
**Paper ref**: Section 4.2 (matching delegatees with capabilities)

**What**: Augment capability scoring with provider-specific strengths so routing considers what each CLI tool is inherently good at.

```typescript
const PROVIDER_STRENGTHS: Record<ProviderId, string[]> = {
  'claude-code':   ['typescript', 'refactoring', 'testing', 'debugging', 'architecture', 'complex-reasoning'],
  'gemini-cli':    ['python', 'data-analysis', 'research', 'documentation', 'multimodal'],
  'codex-cli':     ['code-generation', 'boilerplate', 'rapid-prototyping', 'simple-tasks'],
  'openhands':     ['full-stack', 'deployment', 'docker', 'infrastructure', 'web-apps'],
  'opencode':      ['go', 'rust', 'systems-programming', 'performance'],
  'cursor-agent':  ['frontend', 'react', 'css', 'ui-design', 'visual-tasks'],
}
```

**Scoring update**: When council analysis identifies `required_skills`, the scorer matches against both historical performance AND provider strengths. The new formula:
```
score = skill_match(30) + success_rate(25) + provider_fit(20) + speed(10) + trust(10) + recency(5)
```

**Where**: Extend `src/services/account-capabilities.ts`, `src/providers/types.ts`

**Why**: Current routing treats all providers the same. A TypeScript refactoring task should prefer Claude Code over Codex CLI, and the system should know this without needing historical data.

---

## P2: Safety & Resilience

### F-09: Algorithmic Circuit Breakers
**Paper ref**: Section 4.7 (Permission Handling — circuit breakers)

**What**: Automatic safety mechanisms that quarantine agents exhibiting anomalous behavior.

**Triggers**:
- Trust score drops > 20 points in 24 hours
- 3+ consecutive task failures
- Agent fails verification check on a `criticality: high` task
- Agent becomes unresponsive for > 30 minutes during an active task

**Actions**:
- Revoke all active delegations for the agent
- Mark agent as `quarantined` in health monitor
- Require human review before re-enabling
- Emit `CIRCUIT_BREAKER_TRIGGERED` event

**Where**: New `src/services/circuit-breaker.ts`, integrate with health monitor and trust store

---

### F-10: Verifiable Task Completion Receipts
**Paper ref**: Section 4.8 (Verifiable Task Completion)

**What**: When a task is verified (auto-acceptance passes or human accepts), produce a structured verification receipt.

```typescript
interface VerificationReceipt {
  taskId: string
  handoffId: string
  delegator: string
  delegatee: string
  specHash: string              // hash of the original handoff contract
  timestamp: string
  verificationMethod: 'auto-test' | 'human-review' | 'council-review'
  testResults?: AcceptanceResult
  verdict: 'accepted' | 'rejected'
  notes?: string
}
```

**Storage**: Persisted in activity store, queryable for accountability audits.

**Where**: Extend `src/services/auto-acceptance.ts`, `src/services/tasks.ts`

**Why**: Non-repudiable proof of task completion enables trust building and dispute resolution.

---

### F-11: Cognitive Friction for High-Stakes Decisions
**Paper ref**: Section 5.1 (Meaningful Human Control), Section 2.2 (Zone of Indifference)

**What**: For tasks with `criticality: high/critical` AND `reversibility: irreversible/partial`, force explicit human confirmation before delegation or acceptance.

**Logic**:
```
If criticality >= high AND reversibility <= partial:
  → Show risk assessment in TUI
  → Require explicit confirmation (not auto-accept)
  → Log human decision with justification
  → Emit COGNITIVE_FRICTION_TRIGGERED event

If criticality == low AND reversibility == reversible:
  → Seamless auto-approval (no friction)
```

**Where**: `src/services/handoff.ts` (gating), `src/services/auto-acceptance.ts` (bypass prevention), new TUI confirmation flow

**Why**: The paper warns about "zone of indifference" — humans rubber-stamping agent outputs. Without this, human oversight becomes performative rather than meaningful.

---

### F-12: Task Input Sanitization
**Paper ref**: Section 4.9 (Security — prompt injection, adversarial content)

**What**: Validate and sanitize all handoff contract fields that could contain adversarial content. Specifically `goal`, `notes`, and `acceptance_criteria`.

**Checks**:
- Maximum field lengths
- No embedded system prompts or instruction overrides
- No executable code in text fields (shell injection patterns)
- No path traversal in `project_dir` or `branch`
- Schema validation for all typed fields

**Where**: `src/services/handoff.ts` (validation), `src/mcp/tools.ts` (input handling)

---

### F-13: Delegation Chain Depth Limits
**Paper ref**: Section 5.2 (Accountability in Long Delegation Chains)

**What**: Track delegation depth (how many times a task has been sub-delegated) and enforce configurable limits.

**New field**: `delegation_depth: number` on handoff contracts (auto-incremented on sub-delegation)

**Config**: `maxDelegationDepth: number` (default: 3)

**Behavior at limit**: Require human re-authorization before further sub-delegation. Emit `DELEGATION_DEPTH_EXCEEDED` event.

**Where**: `src/services/handoff.ts`, `src/daemon/server.ts`

**Why**: Long delegation chains create accountability vacuums (paper §5.2). A→B→C→D means nobody clearly owns the outcome.

---

## P3: Advanced Intelligence

### F-14: A2A-Compatible Agent Cards
**Paper ref**: Section 6 (A2A protocol — agent cards)

**What**: Generate standardized capability manifests for each registered account, exposing skills, success rates, availability, and supported tools.

```typescript
interface AgentCard {
  id: string
  name: string
  provider: ProviderId
  capabilities: string[]
  successRate: number
  avgCompletionMinutes: number
  trustLevel: 'low' | 'medium' | 'high'
  availability: 'active' | 'idle' | 'disconnected' | 'quarantined'
  supportedTools: string[]
  pricing?: { model: string; costPer1kTokens?: number }
  verifiers?: string[]
}
```

**Where**: New `src/services/agent-card.ts`, expose via MCP tool and daemon protocol

**Why**: Foundational for future interop with external agent systems. Immediately useful for capability routing UI in TUI dashboard.

---

### F-15: Mid-Task Agent Switching
**Paper ref**: Section 4.4 (switching delegatees mid-execution)

**What**: When an agent's performance degrades past a threshold during a task, enable swapping the delegatee mid-task.

**Requirements**:
- Checkpoint/state serialization so the new agent can resume
- Transfer of workspace (git worktree already persists)
- Transfer of context (progress reports, artifacts produced so far)
- New MCP tool: `transfer_task({ task_id, from_agent, to_agent, reason, checkpoint_data })`

**Inspired by**: entire.io CLI's checkpoint strategy architecture — `SaveTaskCheckpoint`, `RewindPoint`, incremental checkpoints during subagent execution. Apply similar patterns to agentctl.

**Where**: New capability in `src/services/workflow-engine.ts`, new `src/services/task-transfer.ts`

---

### F-16: Multi-Objective Routing Display
**Paper ref**: Section 4.3 (Multi-objective Optimization)

**What**: Instead of collapsing agent ranking into a single score, expose the trade-off dimensions to the user.

**Current**: `suggestAssignee()` returns a single number per agent.

**Proposed**: Return a breakdown:
```typescript
interface AssignmentCandidate {
  account: string
  totalScore: number
  breakdown: {
    skillMatch: number       // 0-30
    successRate: number      // 0-25
    providerFit: number      // 0-20
    speed: number            // 0-10
    trust: number            // 0-10
    recency: number          // 0-5
  }
  recommendation: string     // "Best for quality" | "Fastest" | "Most reliable"
  tradeoffs: string          // "Higher quality but slower" etc.
}
```

**Where**: Extend `src/services/account-capabilities.ts`, update `suggest_assignee` MCP tool response, update TUI

---

### F-17: Retro → Trust Feedback Loop
**Paper ref**: Section 4.6 (reputation as aggregated, verifiable history)

**What**: Close the feedback loop so retro insights automatically update trust scores.

**Current flow**: Task → Agent works → Accepted/rejected → Retro → Knowledge stored → (dead end)

**Proposed flow**:
```
Task → Agent works → Accepted/rejected
                          ↓
                    Retro runs → Analyzes quality, adherence, issues
                          ↓
                    TRUST_UPDATE event emitted
                          ↓
                    Trust store updated
                          ↓
                    Next assignment influenced by new trust score
```

**Where**: Extend `src/services/retro-engine.ts` to emit trust updates, wire into `src/daemon/trust-store.ts`

---

### F-18: Monitoring Stream Subscription
**Paper ref**: Section 6.1 (MCP monitoring stream extension via SSE)

**What**: New MCP tool + daemon protocol for subscribing to real-time task monitoring events.

```typescript
// MCP tool
subscribe_monitoring({
  task_id?: string,       // specific task, or all
  granularity: 'L0_OPERATIONAL' | 'L1_HIGH_LEVEL_PLAN' | 'L2_COT_TRACE' | 'L3_FULL_STATE',
  event_types?: string[]  // filter by event type
})
```

**Where**: New MCP tool, extend daemon `subscribe` protocol message, new event streaming layer

---

## P4: Long-Term Hardening & Interop

### F-19: Delegation Audit Trail
**Paper ref**: Section 5.2 (Immutable Provenance)

**What**: Dedicated delegation log with immutable entries for every delegation decision.

**Log entry**:
```typescript
interface DelegationLogEntry {
  id: string
  timestamp: string
  taskId: string
  delegator: string
  delegatee: string
  contractHash: string     // hash of handoff payload
  reason: string           // why this agent was selected
  trustScoreAtTime: number
  capabilityScoreAtTime: number
  outcome?: 'accepted' | 'rejected' | 'failed' | 'reassigned'
  verificationReceipt?: string  // reference to receipt ID
}
```

**Where**: Extend `src/services/activity-store.ts` with dedicated `delegation_log` table

---

### F-20: Scoped Delegation Permissions
**Paper ref**: Section 4.7 (Privilege Attenuation), Section 6.1 (Delegation Capability Tokens)

**What**: When a task is delegated, restrict which MCP tools are available to the delegatee based on task requirements.

**Example**: A documentation-only task should not have access to `create_workspace` or `update_task` beyond its own task. A read-only analysis task should not have write tools.

**Where**: `src/mcp/bridge.ts` — tool availability filtering per active task context

---

### F-21: Verification Policy on Handoff Contracts
**Paper ref**: Section 6.1 (A2A Task object extended with verification_policy)

**What**: Make verification requirements explicit rather than implicit on every handoff.

```typescript
verification_policy: {
  mode: 'strict',
  artifacts: [
    { type: 'unit_test_log', validator: 'auto' },
    { type: 'lint_report', validator: 'auto' },
    { type: 'screenshot', validator: 'human' }
  ]
}
```

**Where**: Extend handoff schema, update auto-acceptance to check policy

---

### F-22: Accountability View in TUI
**Paper ref**: Section 5.2 (Immutable Provenance), Section 4.5 (Monitoring)

**What**: For any task outcome, show the full delegation chain — who delegated, who executed, who verified, with timestamps.

**Where**: New component or extension to `TaskBoard.tsx`

---

### F-23: De-skilling Prevention Analytics
**Paper ref**: Section 5.6 (Risk of De-skilling)

**What**: Track human participation rate. If it drops below a configurable threshold, alert and optionally route some easy tasks to human review.

**Where**: `src/services/analytics.ts`, new dashboard widget

---

### F-24: Checkpoint Schema for Agent Swapping
**Paper ref**: Section 4.4 (adaptive coordination with mid-task switching)
**Inspired by**: entire.io CLI's `TaskCheckpointContext` with `ModifiedFiles`, `NewFiles`, `DeletedFiles`, incremental checkpoints

**What**: Standard checkpoint format that captures enough state for another agent to resume a task.

```typescript
interface TaskCheckpoint {
  taskId: string
  handoffId: string
  agent: string
  timestamp: string
  workspace: { branch: string; worktreePath: string }
  progress: { percent: number; currentStep: string }
  artifacts: { created: string[]; modified: string[]; deleted: string[] }
  context: string              // summary of work done so far
  remainingSteps: string[]     // what's left to do
}
```

**Where**: New `src/services/task-checkpoint.ts`

---

### F-25: A2A Communication Layer
**Paper ref**: Section 6 (Protocol analysis — A2A event streams)

**What**: Structured daemon message types for inter-agent coordination beyond simple text messages.

**New message types**:
```typescript
type: 'council_analyze_request'    // Daemon → all connected agents
type: 'council_analyze_response'   // Agent → daemon (their analysis)
type: 'progress_report'            // Agent → daemon (intermediate state)
type: 'capability_query'           // Agent → daemon (ask what agents are available)
type: 'capability_response'        // Daemon → agent (agent cards)
type: 'transfer_request'           // Daemon → agent (receive a task mid-execution)
type: 'verification_request'       // Daemon → agent (verify another agent's output)
type: 'verification_response'      // Agent → daemon (verification result)
```

**Where**: Extend `src/daemon/server.ts` protocol, `src/daemon/framing.ts`

---

## Implementation Order

```
Phase 1: Data Foundation (P0)
  F-01 Enriched Handoff Contract  ←── everything depends on this
  F-02 Event Taxonomy             ←── standardizes all communication
  F-03 Trust & Reputation Store   ←── separate from capability

Phase 2: Core Intelligence (P1)
  F-04 Council Pre-Analysis       ←── multi-model task analysis
  F-05 Adaptive SLA               ←── graduated responses
  F-06 Report Progress Tool       ←── process-level monitoring
  F-08 Provider-Aware Routing     ←── right CLI for right task

Phase 3: Safety (P2)
  F-09 Circuit Breakers           ←── quarantine bad agents
  F-10 Verification Receipts      ←── non-repudiable proof
  F-11 Cognitive Friction         ←── meaningful human oversight
  F-12 Input Sanitization         ←── security hardening
  F-13 Delegation Depth Limits    ←── prevent accountability vacuums

Phase 4: Advanced (P3)
  F-07 Task Decomposition Engine  ←── contract-first decomposition
  F-14 Agent Cards                ←── A2A interop foundation
  F-15 Mid-Task Agent Switching   ←── adaptive re-delegation
  F-16 Multi-Objective Display    ←── transparency in routing
  F-17 Retro → Trust Loop         ←── close the learning loop

Phase 5: Hardening (P4)
  F-18 Monitoring Stream          ←── real-time event subscription
  F-19 Audit Trail                ←── immutable delegation log
  F-20 Scoped Permissions         ←── privilege attenuation
  F-21 Verification Policy        ←── explicit verification contracts
  F-22 Accountability View        ←── TUI delegation chain viewer
  F-23 De-skilling Analytics      ←── human participation tracking
  F-24 Checkpoint Schema          ←── agent swapping support
  F-25 A2A Communication          ←── structured inter-agent protocol
```

---

## What We Deliberately Skip

These paper concepts are **fascinating but premature** for agentctl's current scale:

| Concept | Paper Section | Why Skip |
|---------|--------------|----------|
| zk-SNARK cryptographic verification | §4.8 | Agents run on the same machine — no trust boundary |
| Blockchain-based reputation ledger | §4.6, Table 3 | Single daemon controls all state — no need for tamper-proofing |
| Market-based bidding / RFQ protocol | §4.2, §6.1 | 2-6 agents, not millions — centralized routing is fine |
| Delegation Capability Tokens (DCTs) | §6.1 | Unix socket auth is sufficient for local system |
| Escrow bonds and financial settlement | §4.8 | No economic transactions between local agents |
| Sybil attack defenses | §4.9 | All agents are locally registered — identity is not a problem |
| Collusion detection | §4.9 | Agents don't have independent economic incentives |
| AP2 payment mandates | §6 | No financial transactions in scope |

These become relevant if/when agentctl becomes a networked, multi-machine, multi-organization system. For now, the 25 features above take the paper's principles and apply them at the right scale.
