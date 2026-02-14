import { Text } from "ink";
import { useTheme } from "../themes/index.js";

interface Props {
  percent: number;
  width?: number;
  color?: string;
}

export function UsageBar({ percent, width = 10, color }: Props) {
  const { colors } = useTheme();
  const defaultColor = color ?? colors.success;
  if (percent < 0) return <Text color={colors.textMuted}>unknown</Text>;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const barColor = percent > 80 ? colors.error : percent > 50 ? colors.warning : defaultColor;
  return (
    <Text>
      <Text color={barColor}>{"\u2588".repeat(filled)}</Text>
      <Text color={colors.textMuted}>{"\u2591".repeat(empty)}</Text>
    </Text>
  );
}
