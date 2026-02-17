import { Show, For } from "solid-js";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { useNav } from "../context/nav.js";
import { MASCOT_LINES } from "../../services/help.js";

const SHADOW_CHARS = "\u2554\u2557\u255A\u255D\u2550\u2551";

function MascotLine(props: { line: string }) {
  const { colors } = useTheme();
  const segments: { text: string; shadow: boolean }[] = [];
  for (const ch of props.line) {
    const isShadow = SHADOW_CHARS.includes(ch);
    const isSpace = ch === " ";
    const last = segments[segments.length - 1];
    if (isSpace && last) { last.text += ch; }
    else if (last && last.shadow === isShadow) { last.text += ch; }
    else { segments.push({ text: ch, shadow: isShadow }); }
  }
  return (
    <text>
      <For each={segments}>
        {(seg) => <text fg={seg.shadow ? colors.textMuted : colors.primary}>{seg.text}</text>}
      </For>
    </text>
  );
}

export interface HeaderChatInfo {
  sessionTitle?: string;
  modelName?: string;
  cost?: number;
  accountName?: string;
  accountColor?: string | RGBA;
  unreadCount?: number;
  slaStatus?: "ok" | "warning" | "critical";
}

export function Header(props: { showMascot?: boolean; chatInfo?: HeaderChatInfo }) {
  const { colors } = useTheme();
  const route = useRoute();
  const nav = useNav();
  const view = () => route.data.type;
  const dimNav = () => !nav.globalNavEnabled;
  const isChat = () => view() === "chat";

  const navItems: { key: string; label: string; view: string }[] = [
    { key: "d", label: "ash", view: "dashboard" },
    { key: "l", label: "aunch", view: "launcher" },
    { key: "u", label: "sage", view: "usage" },
    { key: "t", label: "asks", view: "tasks" },
    { key: "m", label: "sg", view: "inbox" },
    { key: "e", label: "sla", view: "sla" },
    { key: "r", label: "prompts", view: "prompts" },
    { key: "c", label: "ouncil", view: "council" },
    { key: "v", label: "erify", view: "verify" },
    { key: "i", label: "entire", view: "entire" },
    { key: "g", label: "chains", view: "chains" },
    { key: "s", label: "treams", view: "streams" },
    { key: "x", label: "chat", view: "chat" },
  ];

  const slaColor = () => {
    const status = props.chatInfo?.slaStatus;
    if (status === "ok") return colors.success;
    if (status === "warning") return colors.warning;
    if (status === "critical") return colors.error;
    return colors.textMuted;
  };

  const truncatedTitle = () => {
    const title = props.chatInfo?.sessionTitle;
    if (!title || title === "New Chat") return null;
    return title.length > 40 ? title.slice(0, 40) + "..." : title;
  };

  return (
    <box flexDirection="column">
      <Show when={props.showMascot}>
        <box flexDirection="row" marginBottom={1}>
          <box flexDirection="column" marginRight={2}>
            <For each={MASCOT_LINES}>{(line) => <MascotLine line={line} />}</For>
          </box>
          <box flexDirection="column" justifyContent="center">
            <text attributes={TextAttributes.BOLD} fg={colors.secondary}>agentctl</text>
            <text fg={colors.textMuted}>Multi-account AI agent manager</text>
          </box>
        </box>
      </Show>
      <box flexDirection="row" paddingLeft={1} paddingRight={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.secondary}>agentctl</text>
        <Show when={isChat() && props.chatInfo} fallback={
          <>
            <text> | </text>
            <For each={navItems}>
              {(item) => (
                <>
                  <text fg={view() === item.view ? colors.primary : colors.textMuted}>[{item.key}]{item.label}</text>
                  <text> </text>
                </>
              )}
            </For>
            <text fg={colors.textMuted}>[a]dd [q]uit</text>
            <Show when={dimNav()}><text fg={colors.textMuted}> | [Esc] nav</text></Show>
          </>
        }>
          <text fg={colors.textMuted}> | </text>
          <Show when={props.chatInfo?.accountName}>
            <text fg={props.chatInfo!.accountColor ?? colors.primary} attributes={TextAttributes.BOLD}>
              {props.chatInfo!.accountName}
            </text>
            <text fg={colors.textMuted}> </text>
          </Show>
          <Show when={props.chatInfo?.modelName}>
            <text fg={colors.primary}>{props.chatInfo!.modelName}</text>
            <text fg={colors.textMuted}> </text>
          </Show>
          <Show when={truncatedTitle()}>
            <text fg={colors.text}>{truncatedTitle()}</text>
            <text fg={colors.textMuted}> </text>
          </Show>
          <Show when={(props.chatInfo?.cost ?? 0) > 0}>
            <text fg={colors.textMuted}>${props.chatInfo!.cost!.toFixed(2)}</text>
            <text fg={colors.textMuted}> </text>
          </Show>
          <Show when={(props.chatInfo?.unreadCount ?? 0) > 0}>
            <text fg={colors.warning} attributes={TextAttributes.BOLD}>[{props.chatInfo!.unreadCount} unread]</text>
            <text> </text>
          </Show>
          <Show when={props.chatInfo?.slaStatus}>
            <text fg={slaColor()}>{"\u25cf"}</text>
            <text> </text>
          </Show>
          <text fg={colors.textMuted}>[Ctrl+P] cmds [Tab] acct [Esc] nav</text>
        </Show>
      </box>
    </box>
  );
}
