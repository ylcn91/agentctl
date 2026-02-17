import { createSignal, onMount, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { loadUsageData, type AccountUsageData } from "../../application/use-cases/load-usage-data.js";

export function UsageDetail() {
  const { colors } = useTheme();
  const route = useRoute();
  const [accounts, setAccounts] = createSignal<AccountUsageData[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedAccount, setSelectedAccount] = createSignal(0);

  onMount(() => {
    loadUsageData().then((data) => { setAccounts(data); setLoading(false); });
  });

  useKeyboard((evt: any) => {
    if (evt.name === "escape" || evt.name === "d") {
      route.navigate({ type: "dashboard" });
    } else if (evt.name === "left") {
      setSelectedAccount((prev) => Math.max(0, prev - 1));
    } else if (evt.name === "right") {
      setSelectedAccount((prev) => Math.min(accounts().length - 1, prev + 1));
    }
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading usage data...</text>}>
      <Show when={accounts().length > 0} fallback={
        <box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <text fg={colors.textMuted}>No accounts configured.</text>
          <text fg={colors.textMuted}>[Esc] Back</text>
        </box>
      }>
        {(() => {
          const maxWeekly = () => Math.max(...accounts().map((a) => a.weeklyTotal), 1);
          const current = () => accounts()[selectedAccount()];
          const currentStats = () => current()?.stats;

          const dailyEntries = () => {
            const stats = currentStats();
            if (!stats) return [];
            const map = new Map<string, number>();
            for (const day of stats.weeklyActivity) {
              map.set(day.date, (map.get(day.date) ?? 0) + day.messageCount);
            }
            return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
          };

          const maxDaily = () => Math.max(...dailyEntries().map(([, v]) => v), 1);

          const modelTotals = () => {
            const stats = currentStats();
            if (!stats) return new Map<string, number>();
            const map = new Map<string, number>();
            for (const [model, usage] of Object.entries(stats.modelUsage)) {
              const total = usage.inputTokens + usage.outputTokens;
              map.set(model, (map.get(model) ?? 0) + total);
            }
            return map;
          };

          const totalTokens = () => Array.from(modelTotals().values()).reduce((a, b) => a + b, 0);

          return (
            <box flexDirection="column" paddingTop={1} paddingBottom={1}>
              <text attributes={TextAttributes.BOLD}>Usage This Week</text>
              <box marginTop={1} flexDirection="column">
                <For each={accounts()}>
                  {({ account, weeklyTotal }) => (
                    <box>
                      <text fg={account.color}>{account.name.padEnd(18)}</text>
                      <text fg={colors.primary}>{"\u2588".repeat(Math.round((weeklyTotal / maxWeekly()) * 20))}</text>
                      <text fg={colors.textMuted}>{"\u2591".repeat(20 - Math.round((weeklyTotal / maxWeekly()) * 20))}</text>
                      <text> {weeklyTotal} msgs</text>
                    </box>
                  )}
                </For>
              </box>

              <Show when={current()}>
                <box marginTop={1} flexDirection="column">
                  <text attributes={TextAttributes.BOLD} fg={current().account.color}>
                    {current().account.name} ({selectedAccount() + 1}/{accounts().length}) [Left/Right to page]
                  </text>

                  <box marginTop={1} flexDirection="column">
                    <text attributes={TextAttributes.BOLD}>Daily breakdown (last 7 days):</text>
                    <For each={dailyEntries()}>
                      {([date, count]) => {
                        const dayName = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
                        const barWidth = Math.round((count / maxDaily()) * 15);
                        return (
                          <box>
                            <text>{dayName.padEnd(6)}</text>
                            <text fg={colors.primary}>{"\u2588".repeat(barWidth)}</text>
                            <text fg={colors.textMuted}>{"\u2591".repeat(15 - barWidth)}</text>
                            <text> {count}</text>
                          </box>
                        );
                      }}
                    </For>
                  </box>

                  <Show when={totalTokens() > 0}>
                    <box marginTop={1} flexDirection="column">
                      <text attributes={TextAttributes.BOLD}>Model split:</text>
                      <For each={Array.from(modelTotals().entries()).sort(([, a], [, b]) => b - a)}>
                        {([model, tokens]) => {
                          const pct = Math.round((tokens / totalTokens()) * 100);
                          const shortName = model.replace("claude-", "").replace("-20250929", "");
                          const barWidth = Math.round((pct / 100) * 15);
                          return (
                            <box>
                              <text>{shortName.padEnd(16)}</text>
                              <text fg={colors.secondary}>{"\u2588".repeat(barWidth)}</text>
                              <text fg={colors.textMuted}>{"\u2591".repeat(15 - barWidth)}</text>
                              <text> {pct}%</text>
                            </box>
                          );
                        }}
                      </For>
                    </box>
                  </Show>
                </box>
              </Show>

              <box marginTop={1}><text fg={colors.textMuted}>[Esc] Back [Left/Right] Page accounts</text></box>
            </box>
          );
        })()}
      </Show>
    </Show>
  );
}
