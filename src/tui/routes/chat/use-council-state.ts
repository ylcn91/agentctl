
import { createSignal, type Accessor } from "solid-js";
import { loadConfig } from "../../../config.js";
import { isDaemonRunning, daemonRequestWithProgress } from "../../../services/daemon-client-stream.js";
import { runCouncilDiscussionDirect } from "../../../services/council-direct.js";
import type { ChatMessage } from "../../../services/chat-session.js";
import type { AccountConfig } from "../../../types.js";
import type { CouncilState, RetroState } from "./council-inline.js";
import type { SessionManager } from "./use-session.js";

export interface CouncilController {
  councilStates: Map<string, CouncilState>;
  councilVersion: () => number;
  retroStates: Map<string, RetroState>;
  retroVersion: () => number;
  lastDecision: Accessor<string | null>;
  clearDecision: () => void;
  startCouncilInChat: (topic: string) => Promise<void>;
  startRetroInChat: (topic: string) => Promise<void>;
}

export function createCouncilController(deps: {
  session: SessionManager;
  accounts: Accessor<AccountConfig[]>;
  daemonConnected: Accessor<boolean>;
}): CouncilController {
  const councilStates = new Map<string, CouncilState>();
  const [councilVersion, setCouncilVersion] = createSignal(0);
  const retroStates = new Map<string, RetroState>();
  const [retroVersion, setRetroVersion] = createSignal(0);
  const [lastDecision, setLastDecision] = createSignal<string | null>(null);

  function clearDecision() {
    setLastDecision(null);
  }

  function addSystemMessage(content: string) {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
    };
    deps.session.setMessages((prev) => [...prev, msg]);
  }

  async function startCouncilInChat(topic: string) {
    const accs = deps.accounts();
    if (accs.length < 2) {
      addSystemMessage("[council] Need at least 2 accounts configured for a council discussion.");
      return;
    }
    const config = await loadConfig().catch(() => null);
    const members = config?.council?.members ?? accs.slice(0, 3).map((a) => a.name);
    const chair = config?.council?.chairman ?? accs[0].name;

    const msgId = crypto.randomUUID();
    const state: CouncilState = {
      topic,
      members,
      phases: [
        { name: "Research", status: "pending", responses: [] },
        { name: "Discussion", status: "pending", responses: [] },
        { name: "Decision", status: "pending", responses: [] },
      ],
      streaming: new Map(),
      done: false,
    };
    councilStates.set(msgId, state);
    setCouncilVersion((v) => v + 1);

    const councilMsg: ChatMessage = {
      id: msgId,
      role: "assistant",
      content: `[council] Discussing: "${topic}"`,
      timestamp: new Date().toISOString(),
    };
    deps.session.setMessages((prev) => [...prev, councilMsg]);

    function updateState() {
      setCouncilVersion((v) => v + 1);
    }

    const PHASE_MAP: Record<string, number> = { analysis: 0, research: 0, peer_review: 1, discussion: 1, synthesis: 2, decision: 2 };
    const PHASE_LABEL: Record<string, string> = { analysis: "Research", research: "Research", peer_review: "Discussion", discussion: "Discussion", synthesis: "Decision", decision: "Decision" };

    let chunkThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    function throttledUpdate() {
      if (chunkThrottleTimer) return;
      chunkThrottleTimer = setTimeout(() => {
        chunkThrottleTimer = null;
        updateState();
      }, 80);
    }

    const handleEvent = (event: any) => {
      const evtType = event.type;

      if (evtType === "member_chunk" || evtType === "AGENT_STREAM_CHUNK") {
        if (event.chunkType === "text" && event.account) {
          const prev = state.streaming.get(event.account);
          state.streaming.set(event.account, {
            text: (prev?.text ?? "") + (event.content ?? ""),
            phase: prev?.phase ?? "Research",
          });
          throttledUpdate();
        }
        return;
      }

      if (evtType === "member_start") {
        state.streaming.set(event.account, {
          text: "",
          phase: PHASE_LABEL[event.stage ?? event.phase ?? "research"] ?? "Research",
        });
        updateState();
        return;
      }

      if (evtType === "member_response" || evtType === "COUNCIL_MEMBER_RESPONSE" || evtType === "member_done") {
        const stage = event.stage ?? event.phase ?? "analysis";
        const phaseIdx = PHASE_MAP[stage] ?? 0;
        const streamed = state.streaming.get(event.account)?.text ?? "";
        const content = event.content || streamed || "";
        if (state.phases[phaseIdx]) {
          state.phases[phaseIdx].responses.push({ account: event.account, content });
        }
        state.streaming.delete(event.account);
        if (stage === "synthesis" || stage === "decision") state.synthesis = content;
        updateState();
      } else if (evtType === "stage_start" || evtType === "phase_start" || evtType === "COUNCIL_STAGE_START") {
        const stage = event.stage ?? event.phase ?? "analysis";
        const phaseIdx = PHASE_MAP[stage] ?? 0;
        if (state.phases[phaseIdx]) state.phases[phaseIdx].status = "active";
        updateState();
      } else if (evtType === "stage_complete" || evtType === "COUNCIL_STAGE_COMPLETE" || evtType === "phase_complete") {
        const stage = event.stage ?? event.phase ?? "analysis";
        const phaseIdx = PHASE_MAP[stage] ?? 0;
        if (state.phases[phaseIdx]) state.phases[phaseIdx].status = "done";
        updateState();
      } else if (evtType === "error") {
        state.error = event.message;
        updateState();
      } else if (evtType === "done") {
        if (event.result) {
          populateFromResult(event.result);
        } else if (event.analysis?.synthesis?.recommendedApproach) {
          state.synthesis = event.analysis.synthesis.recommendedApproach;
        }
        state.streaming.clear();
        updateState();
      }
    };

    function populateFromResult(result: any) {
      if (!result) return;
      const existingByPhase = state.phases.map((p) => {
        const map = new Map<string, string>();
        for (const r of p.responses) { if (r.content) map.set(r.account, r.content); }
        return map;
      });
      for (const phase of state.phases) phase.responses = [];
      for (const msg of result.research ?? []) {
        const content = msg.content || existingByPhase[0]?.get(msg.account) || "";
        state.phases[0].responses.push({ account: msg.account, content });
      }
      for (const msg of result.discussion ?? []) {
        const content = msg.content || existingByPhase[1]?.get(msg.account) || "";
        state.phases[1].responses.push({ account: msg.account, content });
      }
      if (result.decision) {
        const content = result.decision.content || existingByPhase[2]?.get(result.decision.account) || "";
        state.phases[2].responses.push({ account: result.decision.account, content });
      }
      const decisionContent = state.phases[2].responses[0]?.content;
      if (decisionContent) state.synthesis = decisionContent;
      for (const phase of state.phases) {
        if (phase.responses.length > 0) phase.status = "done";
      }
    }

    const daemonOnline = await isDaemonRunning();
    try {
      if (daemonOnline) {
        const daemonResult = await daemonRequestWithProgress(accs[0].name, {
          type: "council_discussion", goal: topic, maxRounds: 2,
          researchTimeoutMs: 180_000, discussionTimeoutMs: 90_000, decisionTimeoutMs: 180_000,
        }, handleEvent, 600_000);
        populateFromResult((daemonResult as any)?.discussion);
      } else {
        await runCouncilDiscussionDirect({
          accounts: accs, members, chairman: chair, goal: topic,
          maxRounds: 2, researchTimeoutMs: 180_000, discussionTimeoutMs: 90_000, decisionTimeoutMs: 180_000,
          onEvent: handleEvent,
        });
      }
      state.done = true;
      if (state.synthesis) {
        setLastDecision(state.synthesis);
      }
      updateState();
    } catch (err: any) {
      state.error = err.message ?? "Council discussion failed";
      updateState();
    }
  }

  async function startRetroInChat(topic: string) {
    const accs = deps.accounts();
    if (accs.length < 2) {
      addSystemMessage("[retro] Need at least 2 accounts configured for a retrospective.");
      return;
    }
    const members = accs.slice(0, 3).map((a) => a.name);

    const msgId = crypto.randomUUID();
    const state: RetroState = {
      topic: topic || "Sprint Retrospective",
      members,
      wellItems: [],
      issueItems: [],
      actionItems: [],
      done: false,
    };
    retroStates.set(msgId, state);
    setRetroVersion((v) => v + 1);

    const retroMsg: ChatMessage = {
      id: msgId,
      role: "assistant",
      content: `[retro] ${state.topic}`,
      timestamp: new Date().toISOString(),
    };
    deps.session.setMessages((prev) => [...prev, retroMsg]);

    function updateState() {
      setRetroVersion((v) => v + 1);
    }

    try {
      const { runCouncilDirect } = await import("../../../services/council-direct.js");
      await runCouncilDirect({
        accounts: accs,
        members,
        chairman: members[0],
        goal: `Retrospective: ${state.topic}. For each participant, provide: (1) What went well, (2) What didn't work, (3) Suggested action items. Format each section clearly.`,
        timeoutMs: 120_000,
        onEvent: (event) => {
          if (event.type === "member_response") {
            const content = event.content;
            if (event.stage === "analysis") {
              state.wellItems.push({ account: event.account, content: extractSection(content, "well") });
              state.issueItems.push({ account: event.account, content: extractSection(content, "issue") });
            } else if (event.stage === "synthesis") {
              const actions = extractActionItems(content);
              state.actionItems.push(...actions);
            }
            updateState();
          } else if (event.type === "error") {
            state.error = event.message;
            updateState();
          }
        },
      });
      state.done = true;
      updateState();
    } catch (err: any) {
      state.error = err.message ?? "Retro failed";
      updateState();
    }
  }

  return { councilStates, councilVersion, retroStates, retroVersion, lastDecision, clearDecision, startCouncilInChat, startRetroInChat };
}

function extractSection(content: string, type: "well" | "issue"): string {
  const lower = content.toLowerCase();
  if (type === "well") {
    const idx = lower.indexOf("went well");
    if (idx >= 0) {
      const afterIdx = lower.indexOf("didn't", idx);
      return content.slice(idx, afterIdx > idx ? afterIdx : idx + 200).trim().slice(0, 300);
    }
  } else {
    const idx = lower.indexOf("didn't");
    if (idx >= 0) {
      const afterIdx = lower.indexOf("action", idx);
      return content.slice(idx, afterIdx > idx ? afterIdx : idx + 200).trim().slice(0, 300);
    }
  }
  return content.slice(0, 200);
}

function extractActionItems(content: string): string[] {
  const lines = content.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().match(/^\d+\./));
  return lines.slice(0, 5).map((l) => l.replace(/^[\s\-\d.]+/, "").trim());
}
