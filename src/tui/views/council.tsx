import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import { atomicRead } from "../../services/file-store.js";
import type { CouncilAnalysis } from "../../services/council.js";
import { isDaemonRunning, daemonRequestWithProgress } from "../../services/daemon-client-stream.js";
import { runCouncilDirect, runCouncilDiscussionDirect } from "../../services/council-direct.js";
import { loadConfig } from "../../config.js";
import type { AccountConfig } from "../../types.js";
import { getHubDir } from "../../paths.js";

interface CouncilMessage {
  id: string;
  account: string;
  role: string;
  stage: string;
  content: string;
  timestamp: string;
}

interface CouncilCache {
  analyses: CouncilAnalysis[];
}

function getCouncilCachePath(): string {
  return `${getHubDir()}/council-cache.json`;
}

type Phase = "config" | "discussing" | "done" | "history";

export function CouncilView() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();

  const [phase, setPhase] = createSignal<Phase>("config");
  const [accounts, setAccounts] = createSignal<AccountConfig[]>([]);
  const [selectedMembers, setSelectedMembers] = createSignal<Set<string>>(new Set());
  const [chairman, setChairman] = createSignal("");
  const [topicInput, setTopicInput] = createSignal("");
  const [configCursor, setConfigCursor] = createSignal(0);
  const [configLoaded, setConfigLoaded] = createSignal(false);
  const [discussionMode, setDiscussionMode] = createSignal(true);
  const [councilMessages, setCouncilMessages] = createSignal<CouncilMessage[]>([]);
  const [stage, setStage] = createSignal("analysis");
  const [stageIndex, setStageIndex] = createSignal(0);
  const [elapsedSec, setElapsedSec] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [analyses, setAnalyses] = createSignal<CouncilAnalysis[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal(0);
  const [historyDetail, setHistoryDetail] = createSignal(false);
  const [memberStatuses, setMemberStatuses] = createSignal<Map<string, "waiting" | "active" | "done">>(new Map());
  const [activePhaseLabel, setActivePhaseLabel] = createSignal("");
  const [streamingBuffers, setStreamingBuffers] = createSignal<Map<string, { text: string; stage: string }>>(new Map());

  let abortController: AbortController | null = null;

  onMount(() => {
    nav.setInputFocus("view");
  });
  onCleanup(() => {
    nav.setInputFocus("global");
    abortController?.abort();
  });

  onMount(() => {
    loadConfig().then((config) => {
      setAccounts(config.accounts);
      setSelectedMembers(new Set(config.council?.members ?? []));
      setChairman(config.council?.chairman ?? "");
      setConfigLoaded(true);
    }).catch(() => setConfigLoaded(true));

    atomicRead<CouncilCache>(getCouncilCachePath()).then((cache) => {
      if (cache && Array.isArray(cache.analyses)) setAnalyses(cache.analyses);
    }).catch(() => {});
  });

  createEffect(on(() => phase(), (p) => {
    if (p !== "discussing") return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    onCleanup(() => clearInterval(id));
  }));

  const memberColor = (name: string): string | RGBA => {
    const acc = accounts().find((a) => a.name === name);
    return acc?.color ?? colors.primary;
  };

  const toggleMember = (name: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const availableMembers = () => accounts().filter((a) => a.name !== chairman());

  const stageLabels = () => discussionMode()
    ? ["1. Research", "2. Discussion", "3. Decision"]
    : ["1. Analysis", "2. Peer Review", "3. Synthesis"];

  let chunkThrottleTimer: ReturnType<typeof setTimeout> | null = null;

  const handleProgress = (event: any) => {
    if (event.type === "member_chunk" || event.type === "AGENT_STREAM_CHUNK") {
      if (event.chunkType === "text" && event.account) {
        setStreamingBuffers((prev) => {
          const next = new Map(prev);
          const existing = next.get(event.account);
          next.set(event.account, {
            text: (existing?.text ?? "") + (event.content ?? ""),
            stage: existing?.stage ?? stage(),
          });
          return next;
        });
        if (!chunkThrottleTimer) {
          chunkThrottleTimer = setTimeout(() => { chunkThrottleTimer = null; }, 80);
        }
      }
      return;
    }

    if (event.type === "member_start") {
      setMemberStatuses((prev) => new Map(prev).set(event.account, "active"));
      setStreamingBuffers((prev) => {
        const next = new Map(prev);
        next.set(event.account, { text: "", stage: event.stage ?? event.phase ?? stage() });
        return next;
      });
      return;
    }

    if (event.type === "COUNCIL_MEMBER_RESPONSE" || event.type === "member_response" || event.type === "member_done") {
      const streamed = streamingBuffers().get(event.account)?.text ?? "";
      const content = event.content || streamed || "";
      setCouncilMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        account: event.account,
        role: event.role ?? "member",
        stage: event.stage ?? event.phase ?? "analysis",
        content,
        timestamp: new Date().toISOString(),
      }]);
      setMemberStatuses((prev) => new Map(prev).set(event.account, "done"));
      setStreamingBuffers((prev) => {
        const next = new Map(prev);
        next.delete(event.account);
        return next;
      });
    } else if (event.type === "COUNCIL_STAGE_COMPLETE" || event.type === "stage_complete" || event.type === "phase_complete") {
      setStageIndex((i) => i + 1);
      const s = event.stage ?? event.phase;
      if (s === "research" || s === "analysis") setStage("discussion");
      else if (s === "discussion" || s === "peer_review") setStage("decision");
    } else if (event.type === "stage_start" || event.type === "phase_start" || event.type === "COUNCIL_STAGE_START") {
      setActivePhaseLabel(event.stage ?? event.phase ?? "Processing...");
    } else if (event.type === "COUNCIL_SESSION_END") {
      setStreamingBuffers(new Map());
      setPhase("done");
    } else if (event.type === "error") {
      setError(event.message);
    } else if (event.type === "done") {
      setStreamingBuffers(new Map());
    }
  };

  const startDiscussion = async (topic: string) => {
    if (!topic.trim() || selectedMembers().size === 0) return;
    setPhase("discussing");
    setElapsedSec(0);
    setStage(discussionMode() ? "research" : "analysis");
    setStageIndex(0);
    setCouncilMessages([]);
    setStreamingBuffers(new Map());
    setError(null);
    setScrollOffset(0);
    setActivePhaseLabel(discussionMode() ? "Researching..." : "Collecting analyses...");
    setMemberStatuses(new Map([...selectedMembers()].map((m) => [m, "waiting" as const])));

    const daemonOnline = await isDaemonRunning();
    const accts = accounts();
    const members = [...selectedMembers()];
    const chair = chairman();

    if (daemonOnline) {
      const first = accts[0];
      if (!first) return;
      if (discussionMode()) {
        daemonRequestWithProgress(first.name, {
          type: "council_discussion", goal: topic, maxRounds: 2,
          researchTimeoutMs: 180_000, discussionTimeoutMs: 90_000, decisionTimeoutMs: 180_000,
        }, handleProgress, 600_000)
          .then(() => {
            atomicRead<CouncilCache>(getCouncilCachePath()).then((c) => { if (c?.analyses) setAnalyses(c.analyses); }).catch(() => {});
            setPhase("done");
          })
          .catch((err: any) => { setError(err.message ?? "Council discussion failed"); setPhase("done"); });
      } else {
        daemonRequestWithProgress(first.name, { type: "council_analyze", goal: topic }, handleProgress, 180_000)
          .then(() => {
            atomicRead<CouncilCache>(getCouncilCachePath()).then((c) => { if (c?.analyses) setAnalyses(c.analyses); }).catch(() => {});
            setPhase("done");
          })
          .catch((err: any) => { setError(err.message ?? "Council analysis failed"); setPhase("done"); });
      }
    } else {
      const ac = new AbortController();
      abortController = ac;
      try {
        if (discussionMode()) {
          await runCouncilDiscussionDirect({
            accounts: accts, members, chairman: chair, goal: topic,
            maxRounds: 2, researchTimeoutMs: 180_000, discussionTimeoutMs: 90_000, decisionTimeoutMs: 180_000,
            signal: ac.signal, onEvent: handleProgress,
          });
        } else {
          await runCouncilDirect({
            accounts: accts, members, chairman: chair, goal: topic,
            signal: ac.signal, onEvent: handleProgress,
          });
        }
        atomicRead<CouncilCache>(getCouncilCachePath()).then((c) => { if (c?.analyses) setAnalyses(c.analyses); }).catch(() => {});
      } catch (err: any) {
        if (!ac.signal.aborted) setError(err.message ?? "Council failed");
      } finally {
        abortController = null;
        setPhase("done");
      }
    }
  };

  useKeyboard((evt: any) => {
    if (nav.inputFocus !== "view") return;
    const p = phase();

    if (p === "config") {
      if (evt.name === "escape") { route.navigate({ type: "dashboard" }); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "h" && configCursor() === 0 && !topicInput()) { setPhase("history"); evt.preventDefault(); evt.stopPropagation(); return; }
      const total = 1 + availableMembers().length;
      if (evt.name === "up" || evt.name === "k") { setConfigCursor((c) => Math.max(0, c - 1)); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "down" || evt.name === "j") { setConfigCursor((c) => Math.min(total - 1, c + 1)); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "d" && configCursor() === 0 && !topicInput()) { setDiscussionMode((m) => !m); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "tab") { const accts = accounts(); const i = accts.findIndex((a) => a.name === chairman()); setChairman(accts[(i + 1) % accts.length].name); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === " " && configCursor() > 0) { const i = configCursor() - 1; const avail = availableMembers(); if (i < avail.length) toggleMember(avail[i].name); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "return") { startDiscussion(topicInput()); evt.preventDefault(); evt.stopPropagation(); return; }
      if (configCursor() === 0) {
        if (evt.name === "backspace") { setTopicInput((p) => p.slice(0, -1)); evt.preventDefault(); evt.stopPropagation(); return; }
        if (evt.name === "space") { setTopicInput((p) => p + " "); evt.preventDefault(); evt.stopPropagation(); return; }
        if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) { setTopicInput((p) => p + evt.name); evt.preventDefault(); evt.stopPropagation(); return; }
      }
      return;
    }

    if (p === "discussing") {
      if (evt.name === "j" || evt.name === "down") setScrollOffset((o) => o + 1);
      else if (evt.name === "k" || evt.name === "up") setScrollOffset((o) => Math.max(0, o - 1));
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (p === "done") {
      if (evt.name === "escape") { setPhase("config"); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "r") { setPhase("config"); setTopicInput(""); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "h") { setPhase("history"); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "j" || evt.name === "down") setScrollOffset((o) => o + 1);
      else if (evt.name === "k" || evt.name === "up") setScrollOffset((o) => Math.max(0, o - 1));
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (p === "history") {
      if (evt.name === "escape") {
        if (historyDetail()) { setHistoryDetail(false); } else { setPhase("config"); }
        evt.preventDefault(); evt.stopPropagation(); return;
      }
      if (evt.name === "return" && !historyDetail() && analyses().length > 0) { setHistoryDetail(true); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "r") { atomicRead<CouncilCache>(getCouncilCachePath()).then((c) => { if (c?.analyses) setAnalyses(c.analyses); }).catch(() => {}); evt.preventDefault(); evt.stopPropagation(); return; }
      if (evt.name === "up" || evt.name === "k") setHistoryIndex((i) => Math.max(0, i - 1));
      else if (evt.name === "down" || evt.name === "j") {
        const max = historyDetail()
          ? (analyses()[historyIndex()]?.individualAnalyses.length ?? 1) - 1
          : analyses().length - 1;
        setHistoryIndex((i) => Math.min(max, i + 1));
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }
  });

  return (
    <Show when={configLoaded()} fallback={<text fg={colors.textMuted}>Loading config...</text>}>
      <box flexDirection="column" paddingTop={1} paddingLeft={2} paddingRight={2} flexGrow={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.text}>Council</text>

        <Show when={phase() === "config"}>
          <box flexDirection="column" marginTop={1}>
            <box flexDirection="row" gap={2}>
              <text fg={colors.textMuted}>Mode:</text>
              <text fg={colors.primary} attributes={TextAttributes.BOLD}>
                {discussionMode() ? "Discussion" : "Analysis"}
              </text>
              <text fg={colors.textMuted}>(d to toggle)</text>
            </box>
            <box flexDirection="row" gap={2} marginTop={1}>
              <text fg={colors.textMuted}>Chairman:</text>
              <text fg={memberColor(chairman()) as any} attributes={TextAttributes.BOLD}>
                {chairman() || "none"}
              </text>
              <text fg={colors.textMuted}>(Tab to cycle)</text>
            </box>

            <box marginTop={1} flexDirection="column">
              <box flexDirection="row">
                <text fg={configCursor() === 0 ? colors.primary : colors.textMuted}>
                  {configCursor() === 0 ? "> " : "  "}
                </text>
                <text fg={colors.text}>Topic: </text>
                <text fg={colors.primary}>{topicInput()}<text fg={configCursor() === 0 ? colors.primary : colors.textMuted}>_</text></text>
              </box>
            </box>

            <box marginTop={1} flexDirection="column">
              <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Members (Space to toggle)</text>
              <For each={availableMembers()}>
                {(acc, i) => (
                  <box flexDirection="row">
                    <text fg={configCursor() === i() + 1 ? colors.primary : colors.textMuted}>
                      {configCursor() === i() + 1 ? "> " : "  "}
                    </text>
                    <text fg={selectedMembers().has(acc.name) ? colors.success : colors.textMuted}>
                      {selectedMembers().has(acc.name) ? "[x] " : "[ ] "}
                    </text>
                    <text fg={memberColor(acc.name) as any}>{acc.name}</text>
                  </box>
                )}
              </For>
            </box>

            <box marginTop={1}>
              <text fg={colors.textMuted}>
                Enter start  h history  d mode  Tab chairman  Esc back
              </text>
            </box>
          </box>
        </Show>

        <Show when={phase() === "discussing"}>
          <box flexDirection="column" marginTop={1}>
            <box flexDirection="row" gap={2}>
              <text fg={colors.info} attributes={TextAttributes.BOLD}>{activePhaseLabel()}</text>
              <text fg={colors.textMuted}>{elapsedSec()}s</text>
            </box>

            <box marginTop={1} flexDirection="row" gap={2}>
              <text fg={colors.textMuted}>Stage:</text>
              <For each={stageLabels()}>
                {(label, i) => (
                  <text fg={i() <= stageIndex() ? colors.success : colors.textMuted}>
                    {label}
                  </text>
                )}
              </For>
            </box>

            <box marginTop={1} flexDirection="column">
              <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Members</text>
              <For each={[...selectedMembers()]}>
                {(name) => {
                  const status = () => memberStatuses().get(name) ?? "waiting";
                  const statusColor = () => {
                    const s = status();
                    if (s === "active") return colors.info;
                    if (s === "done") return colors.success;
                    return colors.textMuted;
                  };
                  return (
                    <box flexDirection="row" gap={1}>
                      <text fg={memberColor(name) as any}>{name.padEnd(16)}</text>
                      <text fg={statusColor()}>{status()}</text>
                    </box>
                  );
                }}
              </For>
            </box>

            <Show when={streamingBuffers().size > 0}>
              <box marginTop={1} flexDirection="column">
                <For each={[...streamingBuffers().entries()]}>
                  {([account, buf]) => (
                    <box flexDirection="column" marginTop={1}>
                      <text fg={memberColor(account) as any} attributes={TextAttributes.BOLD}>
                        {account} ({buf.stage})
                      </text>
                      <text fg={colors.text}>{buf.text.slice(-200)}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>

            <Show when={councilMessages().length > 0}>
              <box marginTop={1} flexDirection="column" flexGrow={1}>
                <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Responses</text>
                <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }}>
                  <For each={councilMessages()}>
                    {(msg) => (
                      <box flexDirection="column" marginTop={1}>
                        <box flexDirection="row" gap={1}>
                          <text fg={memberColor(msg.account) as any} attributes={TextAttributes.BOLD}>{msg.account}</text>
                          <text fg={colors.textMuted}>({msg.stage})</text>
                        </box>
                        <text fg={colors.text}>{msg.content}</text>
                      </box>
                    )}
                  </For>
                </scrollbox>
              </box>
            </Show>

            <box marginTop={1}>
              <text fg={colors.textMuted}>j/k scroll</text>
            </box>
          </box>
        </Show>

        <Show when={phase() === "done"}>
          <box flexDirection="column" marginTop={1}>
            <Show when={error()}>
              <text fg={colors.error}>{error()}</text>
            </Show>

            <Show when={councilMessages().length > 0}>
              <box flexDirection="column" flexGrow={1}>
                <text fg={colors.success} attributes={TextAttributes.BOLD}>Results</text>
                <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }}>
                  <For each={councilMessages()}>
                    {(msg) => (
                      <box flexDirection="column" marginTop={1}>
                        <box flexDirection="row" gap={1}>
                          <text fg={memberColor(msg.account) as any} attributes={TextAttributes.BOLD}>{msg.account}</text>
                          <text fg={colors.textMuted}>({msg.stage})</text>
                        </box>
                        <text fg={colors.text}>{msg.content}</text>
                      </box>
                    )}
                  </For>
                </scrollbox>
              </box>
            </Show>

            <box marginTop={1}>
              <text fg={colors.textMuted}>
                r restart  h history  j/k scroll  Esc back
              </text>
            </box>
          </box>
        </Show>

        <Show when={phase() === "history"}>
          <box flexDirection="column" marginTop={1}>
            <Show when={analyses().length === 0}>
              <text fg={colors.textMuted}>No past analyses found. Press r to refresh.</text>
            </Show>

            <Show when={analyses().length > 0 && !historyDetail()}>
              <box flexDirection="column">
                <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Past Analyses</text>
                <For each={analyses()}>
                  {(a, i) => (
                    <box flexDirection="row">
                      <text fg={i() === historyIndex() ? colors.primary : colors.textMuted}>
                        {i() === historyIndex() ? "> " : "  "}
                      </text>
                      <text fg={colors.text}>{a.taskGoal?.slice(0, 60) ?? "Untitled"}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>

            <Show when={analyses().length > 0 && historyDetail()}>
              <box flexDirection="column" flexGrow={1}>
                <text fg={colors.primary} attributes={TextAttributes.BOLD}>
                  {analyses()[historyIndex()]?.taskGoal ?? "Analysis"}
                </text>
                <Show when={analyses()[historyIndex()]?.synthesis}>
                  <box marginTop={1} flexDirection="column">
                    <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Synthesis</text>
                    <text fg={colors.text}>{analyses()[historyIndex()]?.synthesis.recommendedApproach}</text>
                  </box>
                </Show>
                <Show when={analyses()[historyIndex()]?.individualAnalyses}>
                  <box marginTop={1} flexDirection="column">
                    <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Individual Analyses</text>
                    <For each={analyses()[historyIndex()]?.individualAnalyses ?? []}>
                      {(ia) => (
                        <box flexDirection="column" marginTop={1}>
                          <text fg={colors.primary} attributes={TextAttributes.BOLD}>{ia.account}</text>
                          <text fg={colors.text}>{ia.recommendedApproach}</text>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>
              </box>
            </Show>

            <box marginTop={1}>
              <text fg={colors.textMuted}>
                Enter detail  r refresh  j/k navigate  Esc back
              </text>
            </box>
          </box>
        </Show>
      </box>
    </Show>
  );
}