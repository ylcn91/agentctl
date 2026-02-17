import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute, type Route } from "../context/route.js";
import { useExit } from "../context/exit.js";
import { useDialog } from "./dialog.js";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: string;
}

export const COMMANDS: Command[] = [
  { id: "dashboard", label: "Dashboard", shortcut: "d", action: "dashboard" },
  { id: "launcher", label: "Launch Account", shortcut: "l", action: "launcher" },
  { id: "usage", label: "Usage Detail", shortcut: "u", action: "usage" },
  { id: "tasks", label: "Task Board", shortcut: "t", action: "tasks" },
  { id: "inbox", label: "Message Inbox", shortcut: "m", action: "inbox" },
  { id: "add", label: "Add Account", shortcut: "a", action: "add" },
  { id: "sla", label: "SLA Board", shortcut: "e", action: "sla" },
  { id: "prompts", label: "Prompt Library", shortcut: "r", action: "prompts" },
  { id: "analytics", label: "Analytics", shortcut: "n", action: "analytics" },
  { id: "workflows", label: "Workflows", shortcut: "w", action: "workflows" },
  { id: "health", label: "Health Dashboard", shortcut: "h", action: "health" },
  { id: "council", label: "Council Room", shortcut: "c", action: "council" },
  { id: "verify", label: "Verification View", shortcut: "v", action: "verify" },
  { id: "entire", label: "Entire Sessions", shortcut: "i", action: "entire" },
  { id: "chains", label: "Delegation Chains", shortcut: "g", action: "chains" },
  { id: "streams", label: "Agent Activity", shortcut: "s", action: "streams" },
  { id: "delegate", label: "Delegate to Agent", action: "delegate" },
  { id: "chat", label: "Chat", shortcut: "x", action: "chat" },
  { id: "tdd", label: "TDD Workflow", action: "tdd" },
  { id: "theme", label: "Theme", shortcut: "Ctrl+X t", action: "theme" },
  { id: "help", label: "Help", shortcut: "?", action: "help" },
  { id: "quit", label: "Quit", shortcut: "q", action: "quit" },
  { id: "switch_account", label: "Switch Account", action: "switch_account" },
  { id: "new_chat", label: "New Chat Session", action: "new_chat" },
  { id: "session_list", label: "Session List", action: "session_list" },
  { id: "send_message", label: "Send Message", action: "send_message" },
  { id: "council_analysis", label: "Council Analysis", action: "council_analysis" },
  { id: "health_check", label: "Health Check", action: "health_check" },
  { id: "create_workflow", label: "Create Workflow", action: "create_workflow" },
];

export function fuzzyMatch(query: string, text: string): { matches: boolean; indices: number[] } {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { indices.push(ti); qi++; }
  }
  return { matches: qi === q.length, indices };
}

const MAX_RESULTS = 12;

export function CommandPalette() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const exit = useExit();
  const dialog = useDialog();
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);

  const filtered = createMemo(() => {
    const q = query();
    if (!q) return COMMANDS;
    return COMMANDS.filter((cmd) => fuzzyMatch(q, cmd.label).matches);
  });

  const visibleItems = createMemo(() => filtered().slice(0, MAX_RESULTS));

  function closePalette() {
    nav.setCommandPaletteOpen(false);
    setQuery("");
    setSelected(0);
  }

  function handleCommand(action: string) {
    closePalette();
    dialog.clear();
    if (action === "quit") { exit(); return; }
    if (action === "help") { nav.toggleHelp(); return; }
    if (action === "switch_account") { route.navigate({ type: "chat" }); return; }
    if (action === "new_chat") { route.navigate({ type: "chat" }); return; }
    if (action === "session_list") { route.navigate({ type: "chat" }); return; }
    if (action === "send_message") { route.navigate({ type: "inbox" }); return; }
    if (action === "council_analysis") { route.navigate({ type: "council" }); return; }
    if (action === "health_check") { route.navigate({ type: "health" }); return; }
    if (action === "create_workflow") { route.navigate({ type: "workflows" }); return; }
    route.navigate({ type: action } as Route);
  }

  createEffect(() => {
    if (nav.commandPaletteOpen) {
      dialog.replace(<PaletteContent />, closePalette);
    }
  });

  useKeyboard((evt: any) => {
    if (!nav.commandPaletteOpen) return;

    if (evt.name === "return") {
      const items = visibleItems();
      if (items[selected()]) {
        handleCommand(items[selected()].action);
      }
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (evt.name === "up") {
      setSelected((p) => Math.max(0, p - 1));
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (evt.name === "down") {
      setSelected((p) => Math.min(visibleItems().length - 1, p + 1));
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (evt.name === "backspace") {
      setQuery((p) => p.slice(0, -1));
      setSelected(0);
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

    if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) {
      setQuery((p) => p + evt.name);
      setSelected(0);
      evt.preventDefault();
      evt.stopPropagation();
    }
  });

  function PaletteContent() {
    return (
      <box flexDirection="column">
        <text fg={colors.primary}>Command Palette</text>
        <box flexDirection="row" marginTop={1}>
          <text fg={colors.primary}>{"> "}</text>
          <text fg={colors.text}>{query()}</text>
          <text fg={colors.textMuted}>|</text>
        </box>
        <box flexDirection="column" marginTop={1}>
          <For each={visibleItems()}>
            {(cmd, idx) => {
              const isSelected = () => idx() === selected();
              return (
                <box flexDirection="row">
                  <text fg={isSelected() ? colors.primary : colors.text}>
                    {isSelected() ? "> " : "  "}
                  </text>
                  <box width={24}>
                    <text fg={isSelected() ? colors.text : colors.textMuted}>
                      {cmd.label}
                    </text>
                  </box>
                  <Show when={cmd.shortcut}>
                    <text fg={colors.textMuted}>{cmd.shortcut}</text>
                  </Show>
                </box>
              );
            }}
          </For>
          <Show when={visibleItems().length === 0}>
            <text fg={colors.textMuted}>No matching commands</text>
          </Show>
        </box>
        <box marginTop={1}>
          <text fg={colors.textMuted}>Up/Down to navigate, Enter to select, Esc to close</text>
        </box>
      </box>
    );
  }

  return null;
}
