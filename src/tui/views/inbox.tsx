import { createSignal, createEffect, on, createMemo, onMount, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { loadConfig } from "../../config.js";
import { fetchUnreadMessages } from "../../services/daemon-client.js";

interface Message {
  id: string;
  from: string;
  to: string;
  type: "message" | "handoff";
  content: string;
  timestamp: string;
  context?: Record<string, string>;
}

interface AccountMessages {
  accountName: string;
  accountColor: string;
  messages: Message[];
}

type Mode = "browse" | "search";

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

export function MessageInbox() {
  const { colors } = useTheme();
  const nav = useNav();
  const [accounts, setAccounts] = createSignal<AccountMessages[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedAccount, setSelectedAccount] = createSignal(0);
  const [mode, setMode] = createSignal<Mode>("browse");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [refreshTick, setRefreshTick] = createSignal(0);

  createEffect(on(() => nav.refreshTick, (tick) => {
    if (tick > 0) setRefreshTick((t) => t + 1);
  }, { defer: true }));

  async function load() {
    try {
      const config = await loadConfig();
      const results = await Promise.all(
        config.accounts.map(async (account) => ({
          accountName: account.name,
          accountColor: account.color,
          messages: await fetchUnreadMessages(account.name),
        }))
      );
      setAccounts(results);
    } catch {}
    setLoading(false);
  }

  onMount(() => { load(); });
  createEffect(on(() => refreshTick(), () => { load(); }, { defer: true }));

  const filteredAccounts = createMemo(() => {
    const q = searchQuery().toLowerCase();
    if (!q) return accounts();
    return accounts()
      .map((a) => ({
        ...a,
        messages: a.messages.filter(
          (msg) => msg.from.toLowerCase().includes(q) ||
            msg.content.toLowerCase().includes(q) ||
            msg.type.toLowerCase().includes(q)
        ),
      }))
      .filter((a) => a.accountName.toLowerCase().includes(q) || a.messages.length > 0);
  });

  useKeyboard((evt: any) => {
    if (mode() === "search") {
      if (evt.name === "return" || evt.name === "escape") {
        if (evt.name === "escape") setSearchQuery("");
        setMode("browse"); setSelectedAccount(0);
      } else if (evt.name === "backspace") {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) {
        setSearchQuery((q) => q + evt.name);
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if ((evt.name === "up" || evt.name === "k") && selectedAccount() > 0) {
      setSelectedAccount((i) => i - 1);
    } else if ((evt.name === "down" || evt.name === "j") && selectedAccount() < filteredAccounts().length - 1) {
      setSelectedAccount((i) => i + 1);
    } else if (evt.name === "/") {
      setMode("search"); setSearchQuery("");
    }
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading messages...</text>}>
      <Show when={accounts().length > 0} fallback={
        <box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <text fg={colors.textMuted}>No accounts configured.</text>
          <text fg={colors.textMuted}>Press [a] to add an account, or run: actl add {"<name>"}</text>
        </box>
      }>
        <box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <text attributes={TextAttributes.BOLD}>Inbox ({filteredAccounts().reduce((sum, a) => sum + a.messages.length, 0)} unread)</text>

          <Show when={mode() === "search"}>
            <box flexDirection="row" marginTop={1}>
              <text fg={colors.primary}>Search: </text><text>{searchQuery()}</text><text fg={colors.textMuted}>_</text>
            </box>
          </Show>

          <Show when={searchQuery() && mode() === "browse"}>
            <box marginTop={1}><text fg={colors.primary}>filter: "{searchQuery()}"</text></box>
          </Show>

          <For each={filteredAccounts()}>
            {(a, idx) => (
              <box flexDirection="column" marginTop={1}>
                <box flexDirection="row">
                  <text fg={a.accountColor} attributes={TextAttributes.BOLD}>{a.accountName}</text>
                  <text fg={colors.textMuted}> ({a.messages.length} message{a.messages.length !== 1 ? "s" : ""})</text>
                </box>
                <Show when={a.messages.length === 0}>
                  <box marginLeft={2}><text fg={colors.textMuted}>No new messages</text></box>
                </Show>
                <For each={a.messages}>
                  {(msg) => (
                    <box marginLeft={2} flexDirection="column">
                      <box flexDirection="row">
                        <text fg={msg.type === "handoff" ? colors.warning : colors.text}>
                          [{msg.type}] from {msg.from}
                        </text>
                        <text fg={colors.textMuted}> {formatTime(msg.timestamp)}</text>
                      </box>
                      <box marginLeft={2}><text>{msg.content}</text></box>
                      <Show when={msg.context && Object.keys(msg.context).length > 0}>
                        <box marginLeft={2}>
                          <text fg={colors.textMuted}>
                            context: {Object.entries(msg.context!).map(([k, v]) => `${k}=${v}`).join(", ")}
                          </text>
                        </box>
                      </Show>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
          <box marginTop={1}><text fg={colors.textMuted}>[j/k] navigate  [/] search  [Esc] dashboard  [q] quit</text></box>
        </box>
      </Show>
    </Show>
  );
}
