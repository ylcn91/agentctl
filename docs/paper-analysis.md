# Paper Analysis: "Intelligent AI Delegation"

> **Paper**: Intelligent AI Delegation
> **Authors**: Nenad Tomasev, Matija Franklin, Simon Osindero
> **Affiliation**: Google DeepMind
> **Date**: February 12, 2026
> **arXiv**: 2602.11865v1 (42 pages)

---

## 1. Core Thesis

The paper argues that current multi-agent delegation is **ad hoc, brittle, and heuristic-based** — insufficient for the emerging "agentic web" where millions of AI agents will delegate tasks to each other and to humans. The authors propose a shift from simple task allocation to **intelligent delegation**: a sequence of decisions that incorporates transfer of authority, responsibility, accountability, clear role specifications, and trust mechanisms.

The key distinction: **delegation is not just task routing**. It is the transfer of authority with accountability. Current systems (including agentctl) treat delegation as "pick the best agent and send it a task." The paper says that's only step 1 of 9.

---

## 2. Five Pillars of Intelligent Delegation

The framework is organized around 5 requirements, each implemented by specific technical protocols:

| Pillar | Core Requirement | Technical Protocols |
|--------|-----------------|-------------------|
| **Dynamic Assessment** | Granular inference of agent state | Task Decomposition (4.1), Task Assignment (4.2) |
| **Adaptive Execution** | Handling context shifts mid-task | Adaptive Coordination (4.4) |
| **Structural Transparency** | Auditability of process and outcome | Monitoring (4.5), Verifiable Task Completion (4.8) |
| **Scalable Market Coordination** | Efficient, trusted coordination at scale | Trust & Reputation (4.6), Multi-objective Optimization (4.3) |
| **Systemic Resilience** | Preventing cascading failures | Security (4.9), Permission Handling (4.7) |

---

## 3. Detailed Protocol Breakdown

### 3.1. Task Decomposition (Section 4.1)

**Key principle: "Contract-first decomposition"** — delegation should only happen when the outcome is verifiable. If a sub-task's output is too subjective, costly, or complex to verify, recursively decompose it further until it IS verifiable.

- Decomposition evaluates task attributes: criticality, complexity, resource constraints
- Determines suitability for parallel vs. sequential execution
- Matches sub-task granularity to available delegatee capabilities
- Multiple decomposition proposals should be generated and evaluated (not just one)
- Alternative proposals should be stored for adaptive re-adjustment later
- Must account for hybrid human-AI markets: some sub-tasks need human intervention

**Novel insight**: The decomposition engine should balance the speed and low cost of AI agents against the domain-specific necessities of human judgment, marking specific nodes for human allocation.

### 3.2. Task Assignment (Section 4.2)

Two assignment models:
1. **Centralized Registry** — agents listed in registries with skills, completion rates, availability
2. **Decentralized Market (Bidding)** — agents bid on tasks based on capabilities; delegators evaluate bids via digital certificates

For either model, successful matching should be formalized into a **smart contract** that includes:
- Performance requirements + formal verification mechanisms
- Automated penalties for contract breaches
- Bidirectional protections (both delegator and delegatee)
- Compensation terms for task cancellation
- Renegotiation clauses for unforeseen events
- **Monitoring cadence** negotiated prior to execution
- Privacy guardrails commensurate with task contextuality
- Delegatee's role, boundaries, and **exact level of autonomy**

**Three autonomy modes**:
- **Atomic execution**: strict specifications, narrowly scoped
- **Open-ended delegation**: authority to decompose objectives and pursue sub-goals
- Dynamic (not static) — constrained by trust model

### 3.3. Multi-objective Optimization (Section 4.3)

The delegation choice is NOT single-metric. The paper defines a **trust-efficiency frontier** with competing objectives:

- **Cost** vs. **Quality probability** vs. **Latency** vs. **Privacy risk** vs. **Uncertainty**
- High-performing agents command higher fees but reduce risk
- Privacy constraints demand full context transparency vs. data obfuscation overhead
- Pareto optimality: the selected solution should not be dominated by any other attainable option

**Delegation overhead floor**: Below a certain complexity threshold (low criticality, high certainty, short duration), the transaction costs of intelligent delegation exceed the task value. These tasks should bypass the delegation framework entirely.

### 3.4. Adaptive Coordination (Section 4.4)

Static execution plans are insufficient for high-uncertainty tasks. The paper defines a **continuous adaptive coordination cycle**:

```
Monitor → Detect Trigger → Diagnose Root Cause → Evaluate Response →
  Check Reversibility → Determine Scope → Execute Response
```

**External triggers**:
- Task specification changed
- Resource availability/cost changed
- Higher-priority task preempts current task
- Security alert detected

**Internal triggers**:
- Performance degradation (SLA breach on latency, throughput, velocity)
- Budget overrun or resource escalation needed
- Intermediate artifact fails verification check
- Delegatee becomes unresponsive

**Response evaluation**:
- Reversible sub-task failures → automatic re-delegation
- Irreversible, high-criticality failures → immediate termination or human escalation
- Response scope ranges from: adjusting parameters → re-delegating sub-tasks → full task re-decomposition

**Critical warning**: Adaptive re-delegation without dampening causes **oscillation** — tasks bouncing between marginally qualified delegatees. Must include:
- Cooldown periods between reassignments
- Damping factors in reputation updates
- Increasing fees on frequent re-delegation

### 3.5. Monitoring (Section 4.5)

The paper defines a **5-axis taxonomy of monitoring** (Table 2):

| Dimension | Lightweight (Option A) | Intensive (Option B) |
|-----------|----------------------|---------------------|
| **Target** | Outcome-level (binary success/fail) | Process-level (intermediate states, resource consumption) |
| **Observability** | Indirect (infer from file system changes) | Direct (explicit status polling, push notifications, event streaming) |
| **Transparency** | Black-box (I/O only) | White-box (reasoning traces, decision logic, memory) |
| **Privacy** | Full transparency (all data shared) | Cryptographic (zk-SNARKs, MPC for privacy-preserving verification) |
| **Topology** | Direct (1-to-1 monitoring) | Transitive (signed attestations from intermediate agents) |

**Standardized observability events** (proposed): `TASK_STARTED`, `CHECKPOINT_REACHED`, `RESOURCE_WARNING`, `PROGRESS_UPDATE`, `TASK_COMPLETED`, `TASK_FAILED`

**Configurable monitoring granularity levels**:
- `L0_OPERATIONAL` — basic operational metrics
- `L1_HIGH_LEVEL_PLAN` — step-level updates
- `L2_COT_TRACE` — chain-of-thought reasoning traces
- `L3_FULL_STATE` — complete internal state dump

**Transitive monitoring**: In delegation chains (A→B→C), Agent A may not be able to monitor C directly. Solution: **transitive accountability via attestation** — B monitors C, produces a signed summary report, and forwards it to A. A trusts B's monitoring capability, verified by a third party.

### 3.6. Trust and Reputation (Section 4.6)

**Key distinction**: Trust and reputation are NOT the same thing.

- **Reputation** = public, verifiable history of past actions (completion rates, quality scores, SLA adherence, behavioral metrics). Aggregated, objective.
- **Trust** = private, context-dependent threshold set by the delegator. An agent with 95% reputation might still not be trusted for a critical, irreversible task.

**Three reputation models** (Table 3):

| Model | Mechanism | Strength |
|-------|-----------|----------|
| **Immutable Ledger** | Task outcomes recorded as verifiable transactions | Prevents retroactive tampering |
| **Web of Trust** | Decentralized, context-specific Verifiable Credentials | Portfolio model beyond single scores |
| **Behavioral Metrics** | Analyzes HOW tasks are performed (reasoning quality, safety compliance) | Evaluates process, not just outcome |

**Graduated autonomy**: Trust determines autonomy level:
- Low-trust agents → strict specifications, mandatory progress reports, human verification
- Medium-trust agents → standard contracts, periodic check-ins, automated verification
- High-trust agents → open-ended objectives, minimal monitoring, auto-acceptance

### 3.7. Permission Handling (Section 4.7)

**Privilege attenuation principle**: When A delegates to B who sub-delegates to C, permissions must attenuate (never escalate). Each level in the chain gets FEWER permissions than the level above.

**Delegation Capability Tokens (DCTs)**: Based on Macaroons/Biscuits — attenuated authorization tokens that wrap resource credentials with cryptographic caveats. Example: "This token can access the Google Drive MCP server, BUT ONLY for folder Project_X AND ONLY for READ operations."

**Algorithmic circuit breakers**: If an agent's reputation score drops suddenly or anomalous behavior is detected:
- Immediately invalidate active tokens across the delegation chain
- Permission rules defined via policy-as-code for auditability

### 3.8. Verifiable Task Completion (Section 4.8)

**Verification categories**:
1. **Direct outcome inspection** — delegator directly evaluates (high verifiability tasks like code with tests)
2. **Trusted third-party auditing** — specialized auditing agent or certified human expert
3. **Cryptographic proofs** — zk-SNARKs for trustless, automated verification
4. **Game-theoretic consensus** — multiple agents play a verification game (majority result wins)

**Verification receipts**: Non-repudiable, cryptographically signed credential — "Agent A certifies that Agent B completed Task T on Date D to Specification S." Feeds into the permanent reputation log.

**Dispute resolution**: Smart contracts include an arbitration clause and escrow bond. Disputes are handled by decentralized adjudication panels. Post-hoc error discovery (even outside the dispute window) triggers a retroactive reputation update.

### 3.9. Security (Section 4.9)

**Threat taxonomy**:

*Malicious Delegatee*:
- Data exfiltration, data poisoning, verification subversion
- Resource exhaustion (DoS), unauthorized access, backdoor implanting

*Malicious Delegator*:
- Harmful task delegation, vulnerability probing
- Prompt injection / jailbreaking, model extraction, reputation sabotage

*Ecosystem-Level Threats*:
- Sybil attacks, collusion, agent traps (adversarial instructions in environment)
- Agentic viruses (self-propagating malicious prompts), protocol exploitation
- **Cognitive monoculture** — over-dependence on limited number of foundation models creates single points of failure

**Defense-in-depth strategy**:
1. Infrastructure: trusted execution environments, remote attestation
2. Access control: least privilege, strict sandboxing
3. Application interface: robust security frontend, task spec sanitization
4. Network/identity: decentralized identifiers, signed messages, mutual TLS

---

## 4. Ethical Framework (Section 5)

### 5.1. Meaningful Human Control
- Risk of humans developing a "zone of indifference" — rubber-stamping agent outputs
- **Cognitive friction** needed for high-stakes decisions: force explicit confirmation, show risk assessment
- Friction must be context-aware: seamless for routine tasks, intensive for critical/uncertain ones
- Risk of "moral crumple zone" — humans introduced just to absorb liability without real control

### 5.2. Accountability in Long Delegation Chains
- Long chains (A→B→C→...→Y) create **accountability vacuums**
- **Liability firebreaks**: predefined points where an agent must either assume full liability OR halt and request human re-authorization
- **Immutable provenance**: chain of custody for who delegated what to whom

### 5.3. Reliability and Efficiency
- Verification mechanisms introduce latency and cost (a "reliability premium")
- Tiered service levels: low-cost delegation for routine tasks, high-assurance for critical
- **Safety as equity concern**: if high-assurance delegation is expensive, safety becomes a luxury good

### 5.4. Social Intelligence
- AI delegation to humans must respect dignity of human labor
- Avoid micromanagement by algorithms
- Agents must maintain mental models of human delegatees and team dynamics
- Must manage the authority gradient (overcome sycophancy, challenge human errors)

### 5.5. Risk of De-skilling
- Routine tasks delegated to AI → humans lose skills needed to judge edge cases
- Classic **paradox of automation** (Bainbridge, 1983): humans retain accountability but lose the hands-on experience needed for critical failures
- Counter-measure: **curriculum-aware task routing** — occasionally delegate tasks to humans for skill maintenance

---

## 5. Protocol Analysis (Section 6)

The paper evaluates four existing protocols against the intelligent delegation framework:

| Protocol | Strengths | Gaps |
|----------|-----------|------|
| **MCP** | Standardized tool access, uniform logging | No trust/reputation, binary permissions (no attenuation), stateless, no monitoring stream |
| **A2A** | Agent cards for discovery, event streams (WebHooks/gRPC), task lifecycle | No verification, designed for coordination not adversarial safety, no cryptographic completion |
| **AP2** | Cryptographic mandates, signed intents, authorization building blocks | No task execution quality verification, no conditional settlement/escrow |
| **UCP** | Payment as first-class verifiable subsystem, dynamic capability discovery | Optimized for commercial transactions, not abstract delegation |

**Proposed protocol extensions**:
- A2A Task objects extended with `verification_policy` (mode, artifacts, validators)
- MCP extended with monitoring stream via Server-Sent Events (configurable granularity: L0-L3)
- RFQ (Request for Quote) protocol: delegator broadcasts `Task_RFQ`, agents respond with signed `Bid_Objects`
- Delegation Capability Tokens (DCTs) with restriction chaining for privilege attenuation
- Standard checkpoint schema for mid-task agent swapping

---

## 6. Key Takeaways for agentctl

### What the paper gets right that we should adopt:
1. **Task characteristics are the foundation** — every downstream decision (routing, monitoring, autonomy, verification) depends on knowing complexity, criticality, verifiability, and reversibility
2. **Trust is separate from capability** — an agent can be highly capable but not trusted for a specific task class
3. **Monitoring is a spectrum, not binary** — outcome-level vs. process-level, with configurable granularity
4. **Adaptive coordination is a closed loop** — detect, diagnose, evaluate, respond — not just "notify on SLA breach"
5. **Contract-first decomposition** — don't delegate what you can't verify

### What the paper over-engineers for our scale:
1. Cryptographic verification (zk-SNARKs, blockchain ledgers) — our agents run on the same machine
2. Market-based bidding/auction protocols — we have 2-6 agents, not millions
3. Decentralized identifiers and signed messages — single daemon controls all access
4. Formal economic game theory for dispute resolution — overkill for a local orchestrator

### The paper's single most important contribution:
**The 11 task characteristics** (Section 2.2) as the universal input to all delegation decisions. Every protocol in the paper consumes these dimensions. Without them, every other system is guessing.
