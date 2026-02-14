import { Box, Text } from "ink";
import { MASCOT_LINES } from "../services/help.js";
import { useTheme } from "../themes/index.js";

const SHADOW_CHARS = "\u2554\u2557\u255A\u255D\u2550\u2551";

function MascotLine({ line, colors }: { line: string; colors: { textMuted: string; primary: string } }) {
  const segments: { text: string; shadow: boolean }[] = [];
  for (const ch of line) {
    const isShadow = SHADOW_CHARS.includes(ch);
    const isSpace = ch === " ";
    const last = segments[segments.length - 1];
    if (isSpace && last) {
      last.text += ch;
    } else if (last && last.shadow === isShadow) {
      last.text += ch;
    } else {
      segments.push({ text: ch, shadow: isShadow });
    }
  }
  return (
    <Text>
      {segments.map((seg, j) => (
        <Text key={j} color={seg.shadow ? colors.textMuted : colors.primary}>{seg.text}</Text>
      ))}
    </Text>
  );
}

export function Header({ view, showMascot, globalNavEnabled = true }: { view: string; showMascot?: boolean; globalNavEnabled?: boolean }) {
  const { colors } = useTheme();
  const dimNav = !globalNavEnabled;
  return (
    <Box flexDirection="column">
      {showMascot && (
        <Box flexDirection="row" marginBottom={1}>
          <Box flexDirection="column" marginRight={2}>
            {MASCOT_LINES.map((line, i) => (
              <MascotLine key={i} line={line} colors={colors} />
            ))}
          </Box>
          <Box flexDirection="column" justifyContent="center">
            <Text bold color={colors.primaryMuted}>agentctl</Text>
            <Text color={colors.textMuted}>Multi-account AI agent manager</Text>
          </Box>
        </Box>
      )}
      <Box borderStyle="round" borderColor={colors.primaryMuted} paddingX={1}>
        <Text bold color={colors.primaryMuted}>agentctl</Text>
        <Text> | </Text>
        <Text color={view === "dashboard" ? colors.primary : colors.textMuted} dimColor={dimNav}>[d]ash</Text>
        <Text> </Text>
        <Text color={view === "launcher" ? colors.primary : colors.textMuted} dimColor={dimNav}>[l]aunch</Text>
        <Text> </Text>
        <Text color={view === "usage" ? colors.primary : colors.textMuted} dimColor={dimNav}>[u]sage</Text>
        <Text> </Text>
        <Text color={view === "tasks" ? colors.primary : colors.textMuted} dimColor={dimNav}>[t]asks</Text>
        <Text> </Text>
        <Text color={view === "inbox" ? colors.primary : colors.textMuted} dimColor={dimNav}>[m]sg</Text>
        <Text> </Text>
        <Text color={view === "sla" ? colors.primary : colors.textMuted} dimColor={dimNav}>[e]sla</Text>
        <Text> </Text>
        <Text color={view === "prompts" ? colors.primary : colors.textMuted} dimColor={dimNav}>[r]prompts</Text>
        <Text> </Text>
        <Text color={view === "council" ? colors.primary : colors.textMuted} dimColor={dimNav}>[c]ouncil</Text>
        <Text> </Text>
        <Text color={view === "verify" ? colors.primary : colors.textMuted} dimColor={dimNav}>[v]erify</Text>
        <Text> </Text>
        <Text color={view === "entire" ? colors.primary : colors.textMuted} dimColor={dimNav}>[i]entire</Text>
        <Text> </Text>
        <Text color={view === "chains" ? colors.primary : colors.textMuted} dimColor={dimNav}>[g]chains</Text>
        <Text> </Text>
        <Text color={colors.textMuted}>[a]dd [q]uit</Text>
        {dimNav && <Text color={colors.textMuted} dimColor> | [Esc] nav</Text>}
      </Box>
    </Box>
  );
}
