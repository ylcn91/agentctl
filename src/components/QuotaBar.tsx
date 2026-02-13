import React from "react";
import { Box, Text } from "ink";
import { UsageBar } from "./UsageBar.js";
import type { QuotaEstimate } from "../providers/types.js";

export function QuotaBar({ estimate }: { estimate: QuotaEstimate }) {
  const confidenceColor =
    estimate.confidence === "high"
      ? "green"
      : estimate.confidence === "medium"
        ? "yellow"
        : "gray";
  return (
    <Box>
      <Text>~5h quota: </Text>
      <UsageBar percent={estimate.percent} />
      <Text> </Text>
      <Text color={confidenceColor}>{estimate.label}</Text>
    </Box>
  );
}
