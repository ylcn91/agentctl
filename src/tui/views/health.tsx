import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import type { AccountHealth } from "../../daemon/health-monitor.js";
import { fetchHealthStatus } from "../../services/health-loader.js";

const REFRESH_INTERVAL_MS = 10_000;

const STATUS_DOTS: Record<string, string> = {
  healthy: "\u25CF",
  degraded: "\u25CF",
  critical: "\u25CF",
};

export function HealthDashboard() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const [statuses, setStatuses] = createSignal<AccountHealth[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [refreshTick, setRefreshTick] = createSignal(0);

  const statusColors: Record<string, string | RGBA> = {
    healthy: colors.success,
    degraded: colors.warning,
    critical: colors.error,
  };

  async function load() {
    try {
      const accounts = await fetchHealthStatus();
      setStatuses(accounts);
    } catch {}
    setLoading(false);
  }

  onMount(() => { load(); });

  createEffect(on(() => refreshTick(), () => { load(); }, { defer: true }));

  createEffect(on(() => nav.refreshTick, (tick) => {
    if (tick > 0) setRefreshTick((t) => t + 1);
  }, { defer: true }));

  const interval = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));

  useKeyboard((evt: any) => {
    if (evt.name === "up" || evt.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (evt.name === "down" || evt.name === "j") {
      setSelectedIndex((i) => Math.min(statuses().length - 1, i + 1));
    } else if (evt.name === "r") {
      setRefreshTick((t) => t + 1);
    } else if (evt.name === "escape") {
      route.navigate({ type: "dashboard" });
    } else { return; }
    evt.preventDefault(); evt.stopPropagation();
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading health data...</text>}>
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>Account Health</text>
          <text fg={colors.textMuted}>  [r]efresh [Esc]back  </text>
          <text fg={colors.success}>{statuses().filter((s) => s.status === "healthy").length} ok</text>
          <text fg={colors.textMuted}> | </text>
          <text fg={colors.warning}>{statuses().filter((s) => s.status === "degraded").length} warn</text>
          <text fg={colors.textMuted}> | </text>
          <text fg={colors.error}>{statuses().filter((s) => s.status === "critical").length} crit</text>
        </box>

        <Show when={statuses().length === 0}>
          <text fg={colors.textMuted}>No accounts configured.</text>
        </Show>
        <For each={statuses()}>
          {(s, idx) => (
            <box flexDirection="row" marginLeft={1}>
              <text fg={idx() === selectedIndex() ? colors.text : colors.textMuted}>
                {idx() === selectedIndex() ? "> " : "  "}
              </text>
              <text fg={statusColors[s.status]}>{STATUS_DOTS[s.status]}</text>
              <text> </text>
              <text attributes={idx() === selectedIndex() ? TextAttributes.BOLD : undefined}>{s.account.padEnd(20)}</text>
              <text fg={statusColors[s.status]}>{s.status.padEnd(10)}</text>
              <text fg={colors.textMuted}>
                {s.connected ? "connected" : "offline"}
                {s.errorCount > 0 ? `  errors: ${s.errorCount}` : ""}
                {s.rateLimited ? "  RATE-LIMITED" : ""}
                {s.slaViolations > 0 ? `  sla: ${s.slaViolations}` : ""}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}
