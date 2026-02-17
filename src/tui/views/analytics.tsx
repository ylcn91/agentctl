import { createSignal, onMount, Show, For, type Accessor } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { loadTasks } from "../../services/tasks.js";
import { computeAnalytics, formatMs, type AnalyticsSnapshot } from "../../services/analytics.js";

export default function Analytics() {
  const { colors } = useTheme();
  const route = useRoute();
  const [snapshot, setSnapshot] = createSignal<AnalyticsSnapshot | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    loadTasks()
      .then((board) => setSnapshot(computeAnalytics(board)))
      .catch((err: any) => setError(err.message));
  });

  useKeyboard((evt: any) => {
    if (evt.name === "escape") route.navigate({ type: "dashboard" });
  });

  return (
    <Show when={!error()} fallback={<box><text fg={colors.error}>Error: {error()}</text></box>}>
      <Show when={snapshot()} fallback={<box><text>Loading...</text></box>}>
        {(snap: Accessor<AnalyticsSnapshot>) => (
          <box flexDirection="column" padding={1}>
            <text attributes={TextAttributes.BOLD} fg={colors.primary}>Analytics Dashboard</text>
            <box marginTop={1}><text>Generated: {snap().generatedAt}</text></box>

            <box flexDirection="column" marginTop={1}>
              <text attributes={TextAttributes.BOLD}>Summary</text>
              <text>  Total Tasks: {snap().totalTasks}</text>
              <text>  Accepted: {snap().totalAccepted}  Rejected: {snap().totalRejected}</text>
              <text>  Accept Rate: {(snap().overallAcceptRate * 100).toFixed(1)}%</text>
              <text>  Avg Cycle Time: {formatMs(snap().avgCycleTimeMs)}</text>
            </box>

            <box flexDirection="column" marginTop={1}>
              <text attributes={TextAttributes.BOLD}>Per Account</text>
              <text>  {"Account".padEnd(20)} {"Assigned".padEnd(10)} {"Accepted".padEnd(10)} {"Rejected".padEnd(10)} {"Rate".padEnd(8)} {"Avg Cycle".padEnd(12)} {"WIP".padEnd(5)}</text>
              <text>  {"\u2500".repeat(75)}</text>
              <For each={snap().perAccount}>
                {(m) => (
                  <text>
                    {"  "}{m.accountName.padEnd(20)} {String(m.assigned).padEnd(10)} {String(m.accepted).padEnd(10)} {String(m.rejected).padEnd(10)} {(m.acceptRate * 100).toFixed(0).padStart(3)}%{"    "} {formatMs(m.avgCycleTimeMs).padEnd(12)} {String(m.currentWip).padEnd(5)}
                  </text>
                )}
              </For>
            </box>

            <Show when={snap().slaViolations.total > 0}>
              <box flexDirection="column" marginTop={1}>
                <text attributes={TextAttributes.BOLD} fg={colors.warning}>SLA Violations: {snap().slaViolations.total}</text>
                <For each={Object.entries(snap().slaViolations.byAction)}>
                  {([action, count]) => <text>  {action}: {count}</text>}
                </For>
              </box>
            </Show>

            <box marginTop={1}><text fg={colors.textMuted}>[Esc] Back to Dashboard</text></box>
          </box>
        )}
      </Show>
    </Show>
  );
}
