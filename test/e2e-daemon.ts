/**
 * E2E Multi-Agent Test — exercises all 20 steps from prompts/e2e-multi-agent-test.md
 * Connects directly to the daemon Unix socket as claude-admin.
 *
 * Usage: bun test/e2e-daemon.ts
 */

import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const SOCKET = join(homedir(), ".agentctl", "hub.sock");
const TOKEN = readFileSync(join(homedir(), ".agentctl", "tokens", "claude-admin.token"), "utf-8").trim();
const ACCOUNT = "claude-admin";

// ─── Protocol helpers ────────────────────────────────────────────────
let reqCounter = 0;
function makeId(): string {
  return `e2e-${Date.now()}-${++reqCounter}`;
}

type Result = { step: number; name: string; status: "PASS" | "FAIL"; notes: string };
const results: Result[] = [];

function record(step: number, name: string, status: "PASS" | "FAIL", notes: string) {
  results.push({ step, name, status, notes });
  const icon = status === "PASS" ? "✅" : "❌";
  console.log(`  ${icon} Step ${step}: ${name} — ${notes}`);
}

// ─── Socket connection with promise-based RPC ────────────────────────
function createClient(): Promise<{
  send: (msg: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const sock = connect(SOCKET);
    let buffer = "";
    const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();

    // Fallback for responses without requestId
    let fallbackResolve: ((v: any) => void) | null = null;

    sock.on("data", (chunk) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const rid = parsed.requestId;
          if (rid && pending.has(rid)) {
            const p = pending.get(rid)!;
            clearTimeout(p.timer);
            pending.delete(rid);
            p.resolve(parsed);
          } else if (fallbackResolve) {
            const fb = fallbackResolve;
            fallbackResolve = null;
            fb(parsed);
          }
        } catch {}
      }
    });

    sock.on("error", reject);

    sock.on("connect", () => {
      const send = (msg: Record<string, unknown>): Promise<Record<string, unknown>> => {
        const requestId = msg.requestId as string || makeId();
        const payload = { ...msg, requestId };
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            pending.delete(requestId);
            rej(new Error(`Timeout waiting for response to ${msg.type} (${requestId})`));
          }, 120_000); // 2 min timeout for council ops
          pending.set(requestId, { resolve: res, reject: rej, timer });
          sock.write(JSON.stringify(payload) + "\n");
        });
      };
      resolve({ send, close: () => sock.end() });
    });
  });
}

// ─── Main test runner ────────────────────────────────────────────────
async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   agentctl E2E Multi-Agent Test                     ║");
  console.log("║   Account: claude-admin                             ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const client = await createClient();

  // ─── Auth ────────────────────────────────────────────────────────
  console.log("▸ Authenticating as claude-admin...");
  const authResp = await client.send({ type: "auth", account: ACCOUNT, token: TOKEN });
  if (authResp.type !== "auth_ok") {
    console.error("Auth failed:", authResp);
    client.close();
    process.exit(1);
  }
  console.log("  ✅ Authenticated\n");

  // ═══════════════════════════════════════════════════════════════════
  // Phase 1: Connectivity & Health
  // ═══════════════════════════════════════════════════════════════════
  console.log("── Phase 1: Connectivity & Health ──────────────────────\n");

  // Step 1: List all agents
  try {
    const resp = await client.send({ type: "list_accounts" });
    const accounts = (resp as any).accounts || [];
    const names = accounts.map((a: any) => a.name).sort();
    const expected = ["claude", "claude-admin", "claude-doksanbir", "codex", "cursor-agent", "opencode"];
    const allPresent = expected.every((n: string) => names.includes(n));
    record(1, "list_accounts", allPresent ? "PASS" : "FAIL",
      `${accounts.length} accounts: ${names.join(", ")}${allPresent ? "" : " — MISSING: " + expected.filter((n: string) => !names.includes(n)).join(", ")}`);
  } catch (e: any) {
    record(1, "list_accounts", "FAIL", e.message);
  }

  // Step 2: Check health
  try {
    const resp = await client.send({ type: "health_check" });
    const uptime = (resp as any).uptime;
    const connectedAccounts = (resp as any).connectedAccounts;
    const memMb = (resp as any).memoryUsageMb;
    record(2, "daemon_health", resp.type === "result" ? "PASS" : "FAIL",
      `uptime=${Math.round((uptime || 0) / 1000)}s, connected=${connectedAccounts}, mem=${memMb}MB, msgStore=${(resp as any).messageStoreOk}`);
  } catch (e: any) {
    record(2, "daemon_health", "FAIL", e.message);
  }

  // Step 3: Broadcast greeting
  try {
    const r1 = await client.send({ type: "send_message", to: "claude", content: "E2E test started — all agents stand by" });
    const r2 = await client.send({ type: "send_message", to: "claude-doksanbir", content: "E2E test started — all agents stand by" });
    record(3, "send_message (broadcast)", r1.type === "result" && r2.type === "result" ? "PASS" : "FAIL",
      `claude: ${(r1 as any).queued ? "queued" : "delivered"}, claude-doksanbir: ${(r2 as any).queued ? "queued" : "delivered"}`);
  } catch (e: any) {
    record(3, "send_message (broadcast)", "FAIL", e.message);
  }

  // Step 4: Count unread
  try {
    const resp = await client.send({ type: "count_unread" });
    record(4, "count_unread", resp.type === "result" ? "PASS" : "FAIL",
      `unread count: ${(resp as any).count}`);
  } catch (e: any) {
    record(4, "count_unread", "FAIL", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 2: Task Lifecycle
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── Phase 2: Task Lifecycle ─────────────────────────────\n");

  // Step 5: Handoff task
  let taskId = "";
  try {
    const resp = await client.send({
      type: "handoff_task",
      to: "claude-doksanbir",
      payload: {
        goal: "Add input validation to the daemon config_reload handler — reject payloads over 10KB",
        acceptance_criteria: [
          "config_reload handler checks payload size before processing",
          "Returns error response for oversized payloads",
          "Unit test covers the size check",
        ],
        run_commands: ["bun test test/config-reload.test.ts"],
        blocked_by: ["none"],
        priority: "P1",
        tags: ["security", "daemon"],
        complexity: "medium",
        criticality: "high",
      },
      context: {
        projectDir: "/Users/yalcindoksanbir/projects/agentctl",
        notes: "E2E test handoff",
      },
    });
    taskId = (resp as any).taskId || (resp as any).handoffId || "";
    record(5, "handoff_task", resp.type === "result" && taskId ? "PASS" : "FAIL",
      `taskId=${taskId}, to=claude-doksanbir`);
  } catch (e: any) {
    record(5, "handoff_task", "FAIL", e.message);
  }

  // Step 6: Report progress
  try {
    if (!taskId) throw new Error("No taskId from step 5");
    const resp = await client.send({
      type: "report_progress",
      taskId,
      percent: 25,
      agent: ACCOUNT,
      currentStep: "analyzing requirements",
    });
    record(6, "report_progress", resp.type === "result" ? "PASS" : "FAIL",
      `taskId=${taskId}, percent=25, step=analyzing requirements`);
  } catch (e: any) {
    record(6, "report_progress", "FAIL", e.message);
  }

  // Step 7: Check SLA (local service call)
  try {
    // check_sla is a local service call, not daemon RPC
    // We'll test it by importing the services directly
    const { loadTasks } = await import("../src/services/tasks.js");
    const { checkStaleTasks, DEFAULT_SLA_CONFIG } = await import("../src/services/sla-engine.js");
    const board = await loadTasks();
    const escalations = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG);
    record(7, "check_sla", "PASS",
      `${escalations.length} escalation(s) found, ${board.tasks.length} total tasks`);
  } catch (e: any) {
    record(7, "check_sla", "FAIL", e.message);
  }

  // Step 8: Check adaptive SLA
  try {
    const resp = await client.send({ type: "adaptive_sla_check" });
    const recs = (resp as any).recommendations || [];
    record(8, "check_adaptive_sla", resp.type === "result" ? "PASS" : "FAIL",
      `${recs.length} recommendation(s)`);
  } catch (e: any) {
    record(8, "check_adaptive_sla", "FAIL", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 3: Council Analysis
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── Phase 3: Council Analysis ───────────────────────────\n");

  // Step 9: Council analysis
  try {
    const resp = await client.send({
      type: "council_analyze",
      goal: "Should agentctl add rate limiting per account on the daemon socket, or rely on the existing idle timeout and max payload checks? Consider: performance overhead, fairness across agents, and implementation complexity.",
      timeoutMs: 120_000,
    });
    const analysis = (resp as any).analysis || resp;
    const hasContent = analysis.approach || analysis.recommended_skills || analysis.complexity;
    record(9, "analyze_task (council)", resp.type === "result" ? "PASS" : "FAIL",
      hasContent
        ? `complexity=${analysis.complexity || "N/A"}, provider=${analysis.best_provider || "N/A"}`
        : `response type: ${resp.type}, keys: ${Object.keys(resp).join(",")}`);
  } catch (e: any) {
    record(9, "analyze_task (council)", "FAIL", e.message);
  }

  // Step 10: Verify task (council verification)
  try {
    const verifyTaskId = taskId || "e2e-test-task";
    const resp = await client.send({
      type: "council_verify",
      taskId: verifyTaskId,
      goal: "Add input validation to the daemon config_reload handler",
      acceptance_criteria: [
        "config_reload handler checks payload size before processing",
        "Returns error response for oversized payloads",
        "Unit test covers the size check",
      ],
      diff: "diff --git a/src/daemon/handlers/misc.ts\n+  if (JSON.stringify(msg).length > 10240) {\n+    safeWrite(socket, reply(msg, { type: 'error', error: 'Payload too large' }));\n+    return;\n+  }",
      testResults: "3 pass, 0 fail",
      filesChanged: ["src/daemon/handlers/misc.ts", "test/config-reload.test.ts"],
      timeoutMs: 120_000,
    });
    const verdict = (resp as any).verdict || "N/A";
    record(10, "verify_task (council)", resp.type === "result" ? "PASS" : "FAIL",
      `verdict=${verdict}`);
  } catch (e: any) {
    record(10, "verify_task (council)", "FAIL", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 4: Knowledge & Prompts
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── Phase 4: Knowledge & Prompts ────────────────────────\n");

  // Step 11: Index knowledge note
  try {
    const resp = await client.send({
      type: "index_note",
      title: "Daemon Schema Enforcement Pattern",
      content: "All daemon RPC messages must be validated by DaemonMessageSchema before reaching handlers. Invalid messages get an error response at the validator level. New RPC types require: (1) Zod schema in schemas.ts, (2) registration in the discriminated union, (3) schema tests in daemon-schemas.test.ts.",
      category: "architecture",
      tags: ["daemon", "schema", "validation", "zod"],
    });
    const entry = (resp as any).entry || resp;
    record(11, "index_note", resp.type === "result" ? "PASS" : "FAIL",
      `id=${entry.id || "N/A"}, title="${entry.title || "N/A"}"`);
  } catch (e: any) {
    record(11, "index_note", "FAIL", e.message);
  }

  // Step 12: Search knowledge
  try {
    const resp = await client.send({
      type: "search_knowledge",
      query: "schema validation",
    });
    const results = (resp as any).results || [];
    // Results are { entry: { title, content, ... }, rank, snippet }
    const found = results.some((r: any) => {
      const title = (r.entry?.title || r.title || "").toLowerCase();
      const content = (r.entry?.content || r.content || "").toLowerCase();
      return title.includes("schema") || content.includes("schema") || title.includes("daemon");
    });
    record(12, "search_knowledge", resp.type === "result" && results.length > 0 ? "PASS" : "FAIL",
      `${results.length} result(s), schema note found: ${found}`);
  } catch (e: any) {
    record(12, "search_knowledge", "FAIL", e.message);
  }

  // Step 13: Save prompt (local service call)
  try {
    const { savePrompt } = await import("../src/services/prompt-library.js");
    const prompt = await savePrompt({
      title: "security-review",
      content: "Review this code change for security issues. Focus on: input validation, injection risks (shell, SQL, XSS), path traversal, authentication bypass, and information leakage. For each finding, rate severity (P0-P3) and suggest a fix.",
    });
    record(13, "save_prompt", prompt && prompt.id ? "PASS" : "FAIL",
      `id=${prompt?.id || "N/A"}, title="${prompt?.title || "N/A"}"`);
  } catch (e: any) {
    record(13, "save_prompt", "FAIL", e.message);
  }

  // Step 14: List prompts (local service call)
  try {
    const { loadPrompts } = await import("../src/services/prompt-library.js");
    const prompts = await loadPrompts();
    const found = prompts.some((p: any) => p.title === "security-review");
    record(14, "list_prompts", found ? "PASS" : "FAIL",
      `${prompts.length} prompt(s), security-review found: ${found}`);
  } catch (e: any) {
    record(14, "list_prompts", "FAIL", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 5: Sessions & Search
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── Phase 5: Sessions & Search ──────────────────────────\n");

  // Step 15: Share session
  // Note: share_session requires the target to be connected to the daemon.
  // We test the protocol correctness: either we get a session or a meaningful error.
  let sessionId = "";
  try {
    const resp = await client.send({
      type: "share_session",
      target: "claude",
      workspace: "/Users/yalcindoksanbir/projects/agentctl",
    });
    if (resp.type === "result") {
      const session = (resp as any).session || resp;
      sessionId = session.id || (resp as any).sessionId || "";
      record(15, "share_session", sessionId ? "PASS" : "FAIL",
        `sessionId=${sessionId}, target=claude`);
    } else if (resp.type === "error" && (resp as any).error?.includes("not connected")) {
      // Target not connected is a valid daemon response — protocol works correctly
      record(15, "share_session", "PASS",
        `correctly rejected: target "claude" not connected (expected when agent offline)`);
    } else {
      record(15, "share_session", "FAIL",
        `unexpected: ${JSON.stringify(resp).slice(0, 100)}`);
    }
  } catch (e: any) {
    record(15, "share_session", "FAIL", e.message);
  }

  // Step 16: Session status
  try {
    const resp = await client.send({
      type: "session_status",
      ...(sessionId ? { sessionId } : {}),
    });
    const session = (resp as any).session;
    const sessions = (resp as any).sessions || [];
    record(16, "session_status", resp.type === "result" ? "PASS" : "FAIL",
      session
        ? `status=${session.status}, id=${session.id}`
        : `${sessions.length} session(s) found`);
  } catch (e: any) {
    record(16, "session_status", "FAIL", e.message);
  }

  // Step 17: Search across accounts
  try {
    const resp = await client.send({
      type: "search_code",
      pattern: "config",
      maxResults: 10,
    });
    const searchResults = (resp as any).results || [];
    record(17, "search_across_accounts", resp.type === "result" ? "PASS" : "FAIL",
      `${searchResults.length} result(s) for pattern "config"`);
  } catch (e: any) {
    record(17, "search_across_accounts", "FAIL", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 6: Trust & Analytics
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── Phase 6: Trust & Analytics ──────────────────────────\n");

  // Step 18: Get trust scores
  try {
    const resp = await client.send({ type: "get_trust" });
    const accounts = (resp as any).accounts || (resp as any).scores || [];
    record(18, "get_trust_scores", resp.type === "result" ? "PASS" : "FAIL",
      Array.isArray(accounts)
        ? `${accounts.length} account(s) with trust data`
        : `response keys: ${Object.keys(resp).join(",")}`);
  } catch (e: any) {
    record(18, "get_trust_scores", "FAIL", e.message);
  }

  // Step 19: Get analytics
  try {
    const resp = await client.send({
      type: "get_analytics",
      fromDate: "2026-01-01T00:00:00Z",
      toDate: "2026-12-31T23:59:59Z",
    });
    const analytics = (resp as any).analytics || resp;
    record(19, "get_analytics", resp.type === "result" ? "PASS" : "FAIL",
      `totalTasks=${analytics.totalTasks ?? "N/A"}, accepted=${analytics.acceptedTasks ?? "N/A"}`);
  } catch (e: any) {
    record(19, "get_analytics", "FAIL", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 7: Read messages
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── Phase 7: Read Messages ──────────────────────────────\n");

  // Step 20: Read all messages
  try {
    const resp = await client.send({ type: "read_messages", limit: 50 });
    const messages = (resp as any).messages || [];
    record(20, "read_messages", resp.type === "result" ? "PASS" : "FAIL",
      `${messages.length} message(s) retrieved`);
  } catch (e: any) {
    record(20, "read_messages", "FAIL", e.message);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════
  client.close();

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   E2E Test Summary                                  ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║ Step │ Feature                    │ Status │ Notes  ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  for (const r of results) {
    const step = String(r.step).padStart(4);
    const name = r.name.padEnd(26).slice(0, 26);
    const status = r.status === "PASS" ? " PASS " : " FAIL ";
    console.log(`║ ${step} │ ${name} │${status}│ ${r.notes.slice(0, 50)}`);
  }
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║   Total: ${pass} PASS, ${fail} FAIL out of ${results.length} steps`.padEnd(55) + "║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("E2E test crashed:", err);
  process.exit(1);
});
