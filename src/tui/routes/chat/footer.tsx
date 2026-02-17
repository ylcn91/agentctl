
import { Show } from "solid-js";
import { TextAttributes, type RGBA } from "@opentui/core";
import { useTheme } from "../../context/theme.js";
import type { Mode } from "./helpers.js";

export interface FooterProps {
  mode: Mode;
  streaming: boolean;
  permissionPending: boolean;
  accountName: string;
  accountColor: string | RGBA;
  providerLabel?: string;
  modelLabel: string;
  totalCost: number;
  planningMode?: boolean;
  delegating?: boolean;
  shellMode?: boolean;
}

export function ChatFooter(props: FooterProps) {
  const { colors } = useTheme();

  const hints = () => {
    if (props.permissionPending) {
      return "y allow  n deny  a always";
    }
    if (props.streaming) {
      return "^C abort  f follow";
    }
    if (props.mode === "browse") {
      return "j/k scroll  Enter type  / command";
    }
    return "tab agents  ctrl+p commands";
  };

  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} flexShrink={0}>
      <box flexDirection="row">
        <Show when={props.shellMode}>
          <text fg={colors.warning} attributes={TextAttributes.BOLD}>shell</text>
          <text fg={colors.textMuted}>{" \u00b7 "}</text>
        </Show>
        <Show when={props.planningMode}>
          <text fg={colors.accent} attributes={TextAttributes.BOLD}>plan</text>
          <text fg={colors.textMuted}>{" \u00b7 "}</text>
        </Show>
        <Show when={props.delegating}>
          <text fg={colors.warning} attributes={TextAttributes.BOLD}>delegating</text>
          <text fg={colors.textMuted}>{" \u00b7 "}</text>
        </Show>
      </box>
      <text fg={colors.textMuted}>{hints()}</text>
    </box>
  );
}
