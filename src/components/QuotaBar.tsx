import { Box, Text } from "ink";
import { UsageBar } from "./UsageBar.js";
import { useTheme } from "../themes/index.js";
import type { QuotaEstimate } from "../providers/types.js";

export function QuotaBar({ estimate }: { estimate: QuotaEstimate }) {
  const { colors } = useTheme();
  const confidenceColor =
    estimate.confidence === "high"
      ? colors.success
      : estimate.confidence === "medium"
        ? colors.warning
        : colors.textMuted;
  return (
    <Box>
      <Text>~5h quota: </Text>
      <UsageBar percent={estimate.percent} />
      <Text> </Text>
      <Text color={confidenceColor}>{estimate.label}</Text>
    </Box>
  );
}
