
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../context/theme.js";
import { LOGO } from "./helpers.js";

export function ChatSplash() {
  const { colors } = useTheme();

  return (
    <scrollbox flexGrow={1} scrollbarOptions={{ visible: false }}>
      <box flexDirection="column" paddingY={2} alignItems="center" flexGrow={1} justifyContent="center">
        <text fg={colors.primary} attributes={TextAttributes.BOLD}>{LOGO}</text>
        <box marginTop={1} />
        <text fg={colors.textMuted}>Multi-account AI agent manager</text>
        <box marginTop={1} flexDirection="column">
          <box flexDirection="row">
            <box width={16}><text fg={colors.primary}>/accounts</text></box>
            <text fg={colors.textMuted}>Switch account</text>
          </box>
          <box flexDirection="row">
            <box width={16}><text fg={colors.primary}>/sessions</text></box>
            <text fg={colors.textMuted}>Browse sessions</text>
          </box>
          <box flexDirection="row">
            <box width={16}><text fg={colors.primary}>Tab</text></box>
            <text fg={colors.textMuted}>Quick switch</text>
          </box>
          <box flexDirection="row">
            <box width={16}><text fg={colors.primary}>Ctrl+P</text></box>
            <text fg={colors.textMuted}>Command palette</text>
          </box>
        </box>
        <box flexDirection="row" marginTop={1}>
          <text fg={colors.textMuted}>Type a message or press </text>
          <text fg={colors.primary}>/</text>
          <text fg={colors.textMuted}> for commands</text>
        </box>
      </box>
    </scrollbox>
  );
}
