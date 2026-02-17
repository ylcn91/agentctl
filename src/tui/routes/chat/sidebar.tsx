
import { For, Show } from "solid-js";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../../context/theme.js";
import type { AccountConfig } from "../../../types.js";
import { SIDEBAR_WIDTH } from "./helpers.js";

export interface TaskSummary {
  total: number;
  inProgress: number;
  currentTask?: string;
}

export interface WorkflowSummary {
  activeCount: number;
  currentWorkflow?: string;
}

const CTX_MAX = 200_000;
const CTX_BAR_WIDTH = 20;

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

interface SidebarProps {
  messages: { role?: string; tokenCount?: number; inputTokens?: number; outputTokens?: number }[];
  conversationTitle: string;
  messageCount: number;
  totalCost: number;
  streaming: boolean;
  streamingChunkCount: number;
  accountName: string;
  accountColor: string | RGBA;
  providerLabel: string;
  accounts: AccountConfig[];
  accountIndex: number;
  taskSummary?: TaskSummary;
  slaStatus?: "ok" | "warning" | "critical";
  workflowSummary?: WorkflowSummary;
}

export function ChatSidebar(props: SidebarProps) {
  const { colors } = useTheme();

  const totalTokens = () =>
    props.messages.reduce((sum, m) => sum + (m.tokenCount ?? 0), 0);

  const contextTokens = () => {
    for (let i = props.messages.length - 1; i >= 0; i--) {
      const m = props.messages[i];
      if (m.role === "assistant" && m.inputTokens != null) return m.inputTokens;
    }
    return 0;
  };

  const contextPct = () => Math.min(1, contextTokens() / CTX_MAX);
  const filledCount = () => Math.max(contextTokens() > 0 ? 1 : 0, Math.round(contextPct() * CTX_BAR_WIDTH));
  const contextColor = () => {
    const pct = contextPct();
    if (pct > 0.85) return colors.error;
    if (pct > 0.6) return colors.warning;
    return colors.success;
  };

  const slaColor = () => {
    if (props.slaStatus === "ok") return colors.success;
    if (props.slaStatus === "warning") return colors.warning;
    if (props.slaStatus === "critical") return colors.error;
    return colors.textMuted;
  };

  return (
    <box
      flexDirection="column"
      width={SIDEBAR_WIDTH}
      paddingX={2}
      paddingY={1}
      border={["left"]}
      borderColor={colors.textMuted}
    >
      <box paddingRight={1}>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{props.conversationTitle}</text>
      </box>

      <box marginTop={1} flexDirection="column">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>Context</text>
        <text fg={colors.textMuted}>{props.messageCount} messages</text>
        <Show when={props.totalCost > 0}>
          <text fg={colors.textMuted}>${props.totalCost.toFixed(4)} spent</text>
        </Show>
        <Show when={totalTokens() > 0}>
          <text fg={colors.textMuted}>{totalTokens().toLocaleString()} tokens</text>
        </Show>
        <Show when={contextTokens() > 0}>
          <box flexDirection="column" marginTop={1}>
            <text fg={colors.text} attributes={TextAttributes.BOLD}>Context Window</text>
            <box flexDirection="row">
              <text fg={contextColor()}>{"\u2588".repeat(filledCount())}</text>
              <text fg={colors.textMuted}>{"\u2591".repeat(CTX_BAR_WIDTH - filledCount())}</text>
            </box>
            <text fg={colors.textMuted}>{fmtTokens(contextTokens())} / {fmtTokens(CTX_MAX)}</text>
          </box>
        </Show>
      </box>

      <box marginTop={1} flexDirection="column">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>Provider</text>
        <box flexDirection="row">
          <text fg={props.streaming ? colors.success : colors.textMuted}>
            {props.streaming ? "\u25cf" : "\u25cb"}{" "}
          </text>
          <text fg={props.accountColor}>{props.accountName}</text>
        </box>
        <text fg={colors.textMuted}>{props.providerLabel}</text>
        <Show when={props.streaming && props.streamingChunkCount > 0}>
          <text fg={colors.textMuted}>{props.streamingChunkCount} chunks</text>
        </Show>
      </box>

      <Show when={props.taskSummary && props.taskSummary.total > 0}>
        <box marginTop={1} flexDirection="column">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>Tasks</text>
          <text fg={colors.textMuted}>{props.taskSummary!.total} total, {props.taskSummary!.inProgress} active</text>
          <Show when={props.taskSummary!.currentTask}>
            <text fg={colors.primary}>{props.taskSummary!.currentTask}</text>
          </Show>
        </box>
      </Show>

      <Show when={props.slaStatus}>
        <box marginTop={1} flexDirection="column">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>SLA</text>
          <box flexDirection="row">
            <text fg={slaColor()}>{"\u25cf"} </text>
            <text fg={slaColor()}>
              {props.slaStatus === "ok" ? "On Track" : props.slaStatus === "warning" ? "At Risk" : "Breached"}
            </text>
          </box>
        </box>
      </Show>

      <Show when={props.workflowSummary && props.workflowSummary.activeCount > 0}>
        <box marginTop={1} flexDirection="column">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>Workflows</text>
          <text fg={colors.textMuted}>{props.workflowSummary!.activeCount} active</text>
          <Show when={props.workflowSummary!.currentWorkflow}>
            <text fg={colors.primary}>{props.workflowSummary!.currentWorkflow}</text>
          </Show>
        </box>
      </Show>

      <Show when={props.accounts.length > 1}>
        <box marginTop={1} flexDirection="column">
          <text fg={colors.text} attributes={TextAttributes.BOLD}>Accounts</text>
          <For each={props.accounts}>
            {(acc, idx) => {
              const isActive = () => idx() === props.accountIndex;
              return (
                <box flexDirection="row">
                  <text fg={isActive() ? colors.success : colors.textMuted}>
                    {isActive() ? "\u25cf" : "\u25cb"}{" "}
                  </text>
                  <text
                    fg={isActive() ? (acc.color || colors.text) : colors.textMuted}
                    attributes={isActive() ? TextAttributes.BOLD : undefined}
                  >
                    {acc.name}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
      </Show>
    </box>
  );
}
