import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import { loadTasks } from "../../services/tasks.js";
import { checkStaleTasks, humanTime, DEFAULT_SLA_CONFIG, type Escalation, type AdaptiveEscalation, type EntireTriggerType } from "../../services/sla-engine.js";

const REFRESH_INTERVAL_MS = 30_000;

const ACTION_LABELS: Record<string, string> = {
  escalate: "ESCALATE",
  reassign_suggestion: "REASSIGN",
  ping: "PING",
  suggest_reassign: "SUGGEST REASSIGN",
  auto_reassign: "AUTO REASSIGN",
  escalate_human: "ESCALATE HUMAN",
  terminate: "TERMINATE",
};

const TRIGGER_LABELS: Record<EntireTriggerType, string> = {
  token_burn_rate: "[token-burn]",
  no_checkpoint: "[no-checkpoint]",
  context_saturation: "[saturation]",
  session_ended_incomplete: "[session-ended]",
};

export function SLABoard() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const [escalations, setEscalations] = createSignal<Escalation[]>([]);
  const [adaptiveEscalations, setAdaptiveEscalations] = createSignal<AdaptiveEscalation[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [refreshTick, setRefreshTick] = createSignal(0);

  const ACTION_COLORS: Record<string, string | RGBA> = {
    escalate: colors.error,
    reassign_suggestion: colors.warning,
    ping: colors.primary,
    suggest_reassign: colors.warning,
    auto_reassign: colors.error,
    escalate_human: colors.error,
    terminate: colors.error,
  };

  onMount(() => { nav.setInputFocus("view"); });
  onCleanup(() => { nav.setInputFocus("global"); });

  async function load() {
    try {
      const board = await loadTasks();
      const escs = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG);
      setEscalations(escs);
    } catch {}
    setLoading(false);
  }

  onMount(() => { load(); });
  createEffect(on(() => refreshTick(), () => { load(); }, { defer: true }));
  createEffect(on(() => nav.refreshTick, (tick) => { if (tick > 0) setRefreshTick((t) => t + 1); }, { defer: true }));

  const interval = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));

  const totalItems = () => escalations().length + adaptiveEscalations().length;

  useKeyboard((evt: any) => {
    if (nav.inputFocus !== "view") return;
    if (evt.name === "up" || evt.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (evt.name === "down" || evt.name === "j") {
      setSelectedIndex((i) => Math.min(totalItems() - 1, i + 1));
    } else if (evt.name === "r") {
      setRefreshTick((t) => t + 1);
    } else if (evt.name === "escape") {
      route.navigate({ type: "dashboard" });
    } else { return; }
    evt.preventDefault(); evt.stopPropagation();
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading SLA data...</text>}>
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>SLA Board</text>
          <text fg={colors.textMuted}>  [r]efresh [Esc]back</text>
        </box>

        <Show when={totalItems() === 0}>
          <text fg={colors.success}>No stale tasks -- all within SLA thresholds.</text>
        </Show>

        <For each={escalations()}>
          {(esc, idx) => (
            <box flexDirection="row" marginLeft={1}>
              <text fg={idx() === selectedIndex() ? colors.text : colors.textMuted}>
                {idx() === selectedIndex() ? "> " : "  "}
              </text>
              <text fg={ACTION_COLORS[esc.action] ?? colors.text}>
                {ACTION_LABELS[esc.action] ?? esc.action}
              </text>
              <text> </text>
              <text fg={colors.textMuted}>[time-sla] </text>
              <text fg={idx() === selectedIndex() ? colors.text : undefined}>{esc.taskTitle}</text>
              <text fg={colors.textMuted}> | {humanTime(esc.staleForMs)} stale</text>
              <Show when={esc.assignee}><text fg={colors.secondary}> @{esc.assignee}</text></Show>
            </box>
          )}
        </For>

        <For each={adaptiveEscalations()}>
          {(esc, idx) => {
            const globalIdx = () => escalations().length + idx();
            return (
              <box flexDirection="row" marginLeft={1}>
                <text fg={globalIdx() === selectedIndex() ? colors.text : colors.textMuted}>
                  {globalIdx() === selectedIndex() ? "> " : "  "}
                </text>
                <text fg={ACTION_COLORS[esc.action] ?? colors.text}>
                  {ACTION_LABELS[esc.action] ?? esc.action}
                </text>
                <text> </text>
                <text fg={colors.textMuted}>{TRIGGER_LABELS[esc.trigger.type] ?? `[${esc.trigger.type}]`} </text>
                <text fg={globalIdx() === selectedIndex() ? colors.text : undefined}>{esc.taskTitle}</text>
                <text fg={colors.textMuted}> | {esc.trigger.detail}</text>
                <Show when={esc.assignee}><text fg={colors.secondary}> @{esc.assignee}</text></Show>
              </box>
            );
          }}
        </For>
      </box>
    </Show>
  );
}
