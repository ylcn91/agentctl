import React from "react";
import { Text } from "ink";

interface Props {
  percent: number;
  width?: number;
  color?: string;
}

export function UsageBar({ percent, width = 10, color = "green" }: Props) {
  if (percent < 0) return <Text color="gray">unknown</Text>;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const barColor = percent > 80 ? "red" : percent > 50 ? "yellow" : color;
  return (
    <Text>
      <Text color={barColor}>{"█".repeat(filled)}</Text>
      <Text color="gray">{"░".repeat(empty)}</Text>
    </Text>
  );
}
