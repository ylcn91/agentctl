
import { Show, createMemo, type JSX } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../../context/theme.js";
import { Spinner } from "../../../ui/spinner.js";
import type { ToolPart, PartStatus } from "../../../../services/chat-session.js";

export interface ToolRendererProps {
  part: ToolPart;
}

export function parseInput(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}

export function shortenPath(filePath: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  if (filePath.startsWith(home)) {
    return "~" + filePath.slice(home.length);
  }
  return filePath;
}

export function StatusIcon(props: { status: PartStatus }) {
  const { colors } = useTheme();
  const icon = () => {
    switch (props.status) {
      case "completed": return "\u2713";
      case "error": return "\u2717";
      case "running": return "\u25A0";
      default: return "\u25CB";
    }
  };
  const color = () => {
    switch (props.status) {
      case "completed": return colors.success;
      case "error": return colors.error;
      case "running": return colors.warning;
      default: return colors.textMuted;
    }
  };
  return <text fg={color()}>{icon()}</text>;
}

export function InlineTool(props: {
  icon: string;
  pending: string;
  complete: unknown;
  summary?: string;
  part: ToolPart;
  children?: JSX.Element;
}) {
  const { colors } = useTheme();
  const fg = createMemo(() => {
    if (props.complete) return colors.textMuted;
    return colors.text;
  });
  const error = createMemo(() =>
    props.part.status === "error" ? props.part.error : undefined,
  );
  return (
    <box paddingLeft={2} flexDirection="column">
      <Show
        when={props.complete}
        fallback={
          <box flexDirection="row">
            <text fg={fg()}>{"~ "}</text>
            <text fg={fg()}>{props.pending}</text>
          </box>
        }
      >
        <box flexDirection="row">
          <text fg={fg()} attributes={TextAttributes.BOLD}>{props.icon}</text>
          <text fg={fg()}>{" "}</text>
          <Show when={props.summary}>
            <text fg={fg()}>{props.summary}</text>
          </Show>
          {props.children}
        </box>
      </Show>
      <Show when={error()}>
        <text fg={colors.error}>{error()}</text>
      </Show>
    </box>
  );
}

export function BlockTool(props: {
  title: string;
  part: ToolPart;
  children: JSX.Element;
}) {
  const { colors } = useTheme();
  const error = createMemo(() =>
    props.part.status === "error" ? props.part.error : undefined,
  );
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={colors.backgroundPanel}
      borderColor={colors.borderSubtle}
    >
      <Show
        when={props.part.status === "running"}
        fallback={
          <text paddingLeft={2} fg={colors.textMuted}>
            {props.title}
          </text>
        }
      >
        <box flexDirection="row" paddingLeft={2}>
          <Spinner />
          <text fg={colors.textMuted}> {props.title.replace(/^# /, "")}</text>
        </box>
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={colors.error}>{error()}</text>
      </Show>
    </box>
  );
}
