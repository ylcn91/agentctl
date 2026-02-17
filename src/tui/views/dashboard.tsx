import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { loadDashboardData, type DashboardAccountData } from "../../application/use-cases/load-dashboard-data.js";
import type { AccountConfig } from "../../types.js";
import type { AgentStats, QuotaEstimate } from "../../providers/types.js";

const REFRESH_INTERVAL_MS = 30_000;

function AccountCard(props: {
  account: AccountConfig;
  stats: AgentStats;
  quota: QuotaEstimate;
  entireStatus?: string;
  unreadMessages: number;
  pairedWith?: string;
}) {
  const { colors } = useTheme();
  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row">
        <text fg={props.account.color} attributes={TextAttributes.BOLD}>{props.account.name}</text>
        <text fg={colors.textMuted}> ({props.account.label})</text>
        <Show when={props.pairedWith}>
          <text fg={colors.secondary} attributes={TextAttributes.BOLD}>{"  "}PAIRED with {props.pairedWith}</text>
        </Show>
        <Show when={props.stats.todayActivity} fallback={<text fg={colors.textMuted}>{"  "}Today: no activity</text>}>
          <text>{"  "}Today: {props.stats.todayActivity!.messageCount} msgs | {props.stats.todayActivity!.sessionCount} sess</text>
        </Show>
      </box>
      <Show when={props.stats.todayTokens}>
        <box marginLeft={2}>
          <text fg={colors.textMuted}>
            Tokens: {Object.entries(props.stats.todayTokens!)
              .map(([m, t]) => `${(t / 1000).toFixed(1)}K ${m.replace("claude-", "")}`)
              .join(", ")}
          </text>
        </box>
      </Show>
      <Show when={props.entireStatus}>
        <box marginLeft={2}>
          <text fg={colors.textMuted}>entire: {props.entireStatus}</text>
        </box>
      </Show>
      <Show when={props.unreadMessages > 0}>
        <box marginLeft={2}>
          <text fg={colors.warning}>inbox: {props.unreadMessages} new message(s)</text>
        </box>
      </Show>
    </box>
  );
}

export function Dashboard() {
  const { colors } = useTheme();
  const nav = useNav();
  const [accounts, setAccounts] = createSignal<DashboardAccountData[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [entireStatuses, setEntireStatuses] = createSignal<Map<string, string>>(new Map());
  const [unreadCounts, setUnreadCounts] = createSignal<Map<string, number>>(new Map());
  const [pairedSessions, setPairedSessions] = createSignal<Map<string, string>>(new Map());
  const [refreshTick, setRefreshTick] = createSignal(0);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  async function load() {
    try {
      const data = await loadDashboardData();
      setAccounts(data.accounts);
      setEntireStatuses(data.entireStatuses);
      setUnreadCounts(data.unreadCounts);
      setPairedSessions(data.pairedSessions);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => { load(); });

  const interval = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));

  createEffect(on(() => refreshTick(), () => { load(); }, { defer: true }));

  createEffect(on(() => nav.refreshTick, (tick) => {
    if (tick > 0) setRefreshTick((t) => t + 1);
  }, { defer: true }));

  useKeyboard((evt: any) => {
    if (nav.inputFocus !== "global") return;
    if (evt.name === "up" || evt.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (evt.name === "down" || evt.name === "j") {
      setSelectedIndex((i) => Math.min(accounts().length - 1, i + 1));
    }
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading accounts...</text>}>
      <Show when={!error()} fallback={
        <box flexDirection="column">
          <text fg={colors.error}>Error loading config: {error()}</text>
        </box>
      }>
        <Show when={accounts().length > 0} fallback={
          <box flexDirection="column" paddingTop={1} paddingBottom={1}>
            <text fg={colors.textMuted}>No accounts configured.</text>
            <text fg={colors.textMuted}>Press [a] to add an account, or run: actl add {"<name>"}</text>
          </box>
        }>
          <box flexDirection="column" paddingTop={1} paddingBottom={1}>
            <For each={accounts()}>
              {(a) => (
                <AccountCard
                  account={a.account}
                  stats={a.stats}
                  quota={a.quota}
                  entireStatus={entireStatuses().get(a.account.name)}
                  unreadMessages={unreadCounts().get(a.account.name) ?? 0}
                  pairedWith={pairedSessions().get(a.account.name)}
                />
              )}
            </For>
          </box>
        </Show>
      </Show>
    </Show>
  );
}
