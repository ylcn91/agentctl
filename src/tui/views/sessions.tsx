import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import { existsSync } from "fs";
import { readdir } from "node:fs/promises";
import { join } from "path";
import type { EntireSessionMetrics, EntirePhase, EntireTokenUsage } from "../../services/entire-adapter.js";

const REFRESH_INTERVAL_MS = 10_000;

const CONTEXT_WINDOWS: Record<string, number> = {
  "Claude Code": 200_000,
  "Gemini CLI": 1_000_000,
  Cursor: 128_000,
  Copilot: 128_000,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;

function totalTokens(usage: EntireTokenUsage | undefined): number {
  if (!usage) return 0;
  let total = usage.input_tokens + usage.cache_creation_tokens + usage.cache_read_tokens + usage.output_tokens;
  if (usage.subagent_tokens) total += totalTokens(usage.subagent_tokens);
  return total;
}

function formatElapsed(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function saturationBar(ratio: number): string {
  const width = 10;
  const filled = Math.min(width, Math.round(ratio * width));
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${Math.round(ratio * 100)}%`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function findSessionsDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, ".git", "entire-sessions");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadAllSessionMetrics(): Promise<EntireSessionMetrics[]> {
  const sessionsDir = findSessionsDir();
  if (!sessionsDir) return [];
  const metrics: EntireSessionMetrics[] = [];
  try {
    const files = await readdir(sessionsDir);
    for (const file of files) {
      if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
      try {
        const data = await Bun.file(join(sessionsDir, file)).text();
        const state = JSON.parse(data);
        if (!state.session_id) continue;
        const phase: EntirePhase = state.phase || "idle";
        const tokens = totalTokens(state.token_usage);
        const startedAt = new Date(state.started_at).getTime();
        const elapsed = isNaN(startedAt) ? 0 : Math.max(0, ((state.ended_at ? new Date(state.ended_at).getTime() : Date.now()) - startedAt) / 60_000);
        const contextWindow = CONTEXT_WINDOWS[state.agent_type ?? ""] ?? DEFAULT_CONTEXT_WINDOW;
        metrics.push({
          sessionId: state.session_id, phase,
          stepCount: state.checkpoint_count ?? 0,
          filesTouched: state.files_touched ?? [],
          totalTokens: tokens,
          tokenBurnRate: elapsed > 0 ? tokens / elapsed : 0,
          contextSaturation: tokens / contextWindow,
          progressEstimate: Math.min(95, (state.files_touched?.length ?? 0) * 10),
          elapsedMinutes: elapsed,
          agentType: state.agent_type ?? "unknown",
        });
      } catch {}
    }
  } catch {}
  return metrics;
}

export function EntireSessions() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const [sessions, setSessions] = createSignal<EntireSessionMetrics[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [refreshTick, setRefreshTick] = createSignal(0);

  const PHASE_COLORS: Record<string, string | RGBA> = {
    active: colors.primary, active_committed: colors.primary,
    idle: colors.warning, ended: colors.textMuted,
  };

  async function load() {
    try { setSessions(await loadAllSessionMetrics()); } catch {}
    setLoading(false);
  }

  onMount(() => { load(); });
  createEffect(on(() => refreshTick(), () => { load(); }, { defer: true }));
  createEffect(on(() => nav.refreshTick, (tick) => { if (tick > 0) setRefreshTick((t) => t + 1); }, { defer: true }));
  const interval = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));

  useKeyboard((evt: any) => {
    if (evt.name === "up" || evt.name === "k") { setSelectedIndex((i) => Math.max(0, i - 1)); }
    else if (evt.name === "down" || evt.name === "j") { setSelectedIndex((i) => Math.min(sessions().length - 1, i + 1)); }
    else if (evt.name === "r") { setRefreshTick((t) => t + 1); }
    else if (evt.name === "escape") { route.navigate({ type: "dashboard" }); }
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading entire.io session data...</text>}>
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>Entire Sessions</text>
          <text fg={colors.textMuted}>  [r]efresh [up/down]navigate [Esc]back  </text>
          <text>{sessions().length} total</text>
          <text fg={colors.textMuted}> | </text>
          <text fg={colors.primary}>{sessions().filter((s) => s.phase === "active" || s.phase === "active_committed").length} active</text>
          <text fg={colors.textMuted}> | </text>
          <text fg={colors.warning}>~{Math.round(sessions().length > 0 ? sessions().reduce((sum, s) => sum + s.tokenBurnRate, 0) / sessions().length : 0)} tok/min avg</text>
        </box>

        <Show when={sessions().length === 0}>
          <text fg={colors.textMuted}>No entire.io sessions detected. Start an AI coding session to see live metrics.</text>
        </Show>
        <For each={sessions()}>
          {(s, idx) => {
            const phaseLabel = s.phase === "active" || s.phase === "active_committed" ? "ACTIVE" : s.phase === "ended" ? "ENDED" : "IDLE";
            const satColor = () => s.contextSaturation > 0.8 ? colors.error : s.contextSaturation > 0.5 ? colors.warning : colors.success;
            return (
              <box flexDirection="column" marginLeft={1} marginBottom={idx() < sessions().length - 1 ? 1 : 0}>
                <box flexDirection="row">
                  <text fg={idx() === selectedIndex() ? colors.text : colors.textMuted}>{idx() === selectedIndex() ? "> " : "  "}</text>
                  <text attributes={idx() === selectedIndex() ? TextAttributes.BOLD : undefined}>{s.sessionId.slice(0, 8)}</text>
                  <text> </text>
                  <text fg={PHASE_COLORS[s.phase] ?? colors.textMuted}>[{phaseLabel}]</text>
                  <text> </text>
                  <text fg={colors.secondary}>{s.agentType}</text>
                  <text fg={colors.textMuted}> steps:{s.stepCount} files:{s.filesTouched.length}</text>
                </box>
                <Show when={idx() === selectedIndex()}>
                  <box marginLeft={4} flexDirection="column">
                    <box flexDirection="row">
                      <text fg={colors.textMuted}>tokens: </text><text>{formatTokenCount(s.totalTokens)}</text>
                      <text fg={colors.textMuted}> burn: </text><text fg={colors.warning}>{Math.round(s.tokenBurnRate)}/min</text>
                      <text fg={colors.textMuted}>  elapsed: </text><text>{formatElapsed(s.elapsedMinutes)}</text>
                    </box>
                    <box flexDirection="row">
                      <text fg={colors.textMuted}>context: </text>
                      <text fg={satColor()}>{saturationBar(s.contextSaturation)}</text>
                    </box>
                  </box>
                </Show>
              </box>
            );
          }}
        </For>
      </box>
    </Show>
  );
}
