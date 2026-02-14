import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { UsageBar } from "./UsageBar.js";
import { useTheme } from "../themes/index.js";
import { loadUsageData, type AccountUsageData } from "../application/use-cases/load-usage-data.js";

interface Props {
  onNavigate: (view: string) => void;
}

export function UsageDetail({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [accounts, setAccounts] = useState<AccountUsageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState(0);

  useEffect(() => {
    loadUsageData().then((data) => {
      setAccounts(data);
      setLoading(false);
    });
  }, []);

  useInput((input, key) => {
    if (key.escape || input === "d") onNavigate("dashboard");
    if (key.leftArrow) {
      setSelectedAccount((prev) => Math.max(0, prev - 1));
    }
    if (key.rightArrow) {
      setSelectedAccount((prev) => Math.min(accounts.length - 1, prev + 1));
    }
  });

  if (loading) return <Text color={colors.textMuted}>Loading usage data...</Text>;

  if (accounts.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={colors.textMuted}>No accounts configured.</Text>
        <Text color={colors.textMuted}>[Esc] Back</Text>
      </Box>
    );
  }

  const maxWeekly = Math.max(...accounts.map((a) => a.weeklyTotal), 1);

  // Current account detail
  const current = accounts[selectedAccount];
  const currentStats = current?.stats;

  // Build daily breakdown for the selected account
  const dailyMap = new Map<string, number>();
  if (currentStats) {
    for (const day of currentStats.weeklyActivity) {
      dailyMap.set(day.date, (dailyMap.get(day.date) ?? 0) + day.messageCount);
    }
  }
  const dailyEntries = Array.from(dailyMap.entries()).sort(
    ([a], [b]) => a.localeCompare(b)
  );
  const maxDaily = Math.max(...dailyEntries.map(([, v]) => v), 1);

  // Model usage for selected account
  const modelTotals = new Map<string, number>();
  if (currentStats) {
    for (const [model, usage] of Object.entries(currentStats.modelUsage)) {
      const total = usage.inputTokens + usage.outputTokens;
      modelTotals.set(model, (modelTotals.get(model) ?? 0) + total);
    }
  }
  const totalTokens = Array.from(modelTotals.values()).reduce((a, b) => a + b, 0);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Usage This Week</Text>
      <Box marginTop={1} flexDirection="column">
        {accounts.map(({ account, weeklyTotal }) => (
          <Box key={account.name}>
            <Box width={18}>
              <Text color={account.color}>{account.name}</Text>
            </Box>
            <UsageBar
              percent={(weeklyTotal / maxWeekly) * 100}
              width={20}
            />
            <Text> {weeklyTotal} msgs</Text>
          </Box>
        ))}
      </Box>

      {current && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={current.account.color}>
            {current.account.name} ({selectedAccount + 1}/{accounts.length}) [←/→ to page]
          </Text>

          <Box marginTop={1} flexDirection="column">
            <Text bold>Daily breakdown (last 7 days):</Text>
            {dailyEntries.map(([date, count]) => {
              const dayName = new Date(date + "T12:00:00").toLocaleDateString(
                "en-US",
                { weekday: "short" }
              );
              const barWidth = Math.round((count / maxDaily) * 15);
              return (
                <Box key={date}>
                  <Box width={6}>
                    <Text>{dayName}</Text>
                  </Box>
                  <Text color={colors.primary}>{"\u2588".repeat(barWidth)}</Text>
                  <Text color={colors.textMuted}>{"\u2591".repeat(15 - barWidth)}</Text>
                  <Text> {count}</Text>
                </Box>
              );
            })}
          </Box>

          {totalTokens > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold>Model split:</Text>
              {Array.from(modelTotals.entries())
                .sort(([, a], [, b]) => b - a)
                .map(([model, tokens]) => {
                  const pct = Math.round((tokens / totalTokens) * 100);
                  const shortName = model
                    .replace("claude-", "")
                    .replace("-20250929", "");
                  const barWidth = Math.round((pct / 100) * 15);
                  return (
                    <Box key={model}>
                      <Box width={16}>
                        <Text>{shortName}</Text>
                      </Box>
                      <Text color={colors.primaryMuted}>{"\u2588".repeat(barWidth)}</Text>
                      <Text color={colors.textMuted}>{"\u2591".repeat(15 - barWidth)}</Text>
                      <Text> {pct}%</Text>
                    </Box>
                  );
                })}
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={colors.textMuted}>[Esc] Back [←/→] Page accounts</Text>
      </Box>
    </Box>
  );
}
