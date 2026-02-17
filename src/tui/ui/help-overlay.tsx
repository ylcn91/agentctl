import { Show, For } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { useNav } from "../context/nav.js";

interface ShortcutGroup {
  title: string;
  shortcuts: { key: string; description: string }[];
}

const GLOBAL_SHORTCUTS: ShortcutGroup = {
  title: "Global",
  shortcuts: [
    { key: "Esc", description: "Back to dashboard / enable nav" },
    { key: "q", description: "Quit" },
    { key: "?", description: "Toggle this help" },
    { key: "Ctrl+r", description: "Refresh current view" },
    { key: "Ctrl+P", description: "Command Palette" },
    { key: "Ctrl+X", description: "Leader Key" },
    { key: "Ctrl+X b", description: "Toggle Sidebar" },
    { key: "Ctrl+X t", description: "Theme Picker" },
  ],
};

const NAV_SHORTCUTS: ShortcutGroup = {
  title: "Navigation (when nav active)",
  shortcuts: [
    { key: "d", description: "Dashboard" },
    { key: "l", description: "Launch agent" },
    { key: "u", description: "Usage detail" },
    { key: "t", description: "Task board" },
    { key: "m", description: "Messages" },
    { key: "a", description: "Add account" },
    { key: "e", description: "SLA board" },
    { key: "r", description: "Prompt library" },
    { key: "n", description: "Analytics" },
    { key: "w", description: "Workflows" },
    { key: "h", description: "Health" },
    { key: "c", description: "Council" },
    { key: "v", description: "Verification" },
    { key: "i", description: "Entire sessions" },
    { key: "g", description: "Delegation chains" },
    { key: "s", description: "Agent activity (streams)" },
    { key: "x", description: "Chat" },
  ],
};

const VIEW_SHORTCUTS: Record<string, ShortcutGroup> = {
  dashboard: { title: "Dashboard", shortcuts: [
    { key: "j/k", description: "Navigate accounts" },
    { key: "Up/Down", description: "Navigate accounts" },
  ]},
  tasks: { title: "Task Board", shortcuts: [
    { key: "j/k", description: "Navigate tasks" },
    { key: "/", description: "Search/filter tasks" },
    { key: "a", description: "Add new task" },
    { key: "s", description: "Advance status" },
    { key: "v", description: "Accept task" },
    { key: "x", description: "Reject task" },
    { key: "p", description: "Toggle priority sort" },
    { key: "Enter", description: "Assign to account" },
    { key: "d", description: "Delete task" },
  ]},
  launcher: { title: "Launcher", shortcuts: [
    { key: "Up/Down", description: "Navigate options" },
    { key: "Space", description: "Toggle option" },
    { key: "Enter", description: "Confirm / Launch" },
  ]},
  inbox: { title: "Message Inbox", shortcuts: [
    { key: "j/k", description: "Navigate accounts" },
    { key: "/", description: "Search/filter messages" },
  ]},
  sla: { title: "SLA Board", shortcuts: [
    { key: "j/k", description: "Navigate escalations" },
    { key: "r", description: "Refresh" },
  ]},
  usage: { title: "Usage Detail", shortcuts: [
    { key: "Left/Right", description: "Page between accounts" },
  ]},
  prompts: { title: "Prompt Library", shortcuts: [
    { key: "j/k", description: "Navigate prompts" },
    { key: "/", description: "Search prompts" },
    { key: "a", description: "Add new prompt" },
    { key: "d", description: "Delete prompt" },
    { key: "Enter", description: "View prompt" },
  ]},
  analytics: { title: "Analytics", shortcuts: [
    { key: "Esc", description: "Back to dashboard" },
  ]},
  workflows: { title: "Workflows", shortcuts: [
    { key: "j/k", description: "Navigate items" },
    { key: "1", description: "Show definitions" },
    { key: "2", description: "Show runs" },
    { key: "Enter", description: "View run detail" },
  ]},
  health: { title: "Health Dashboard", shortcuts: [
    { key: "j/k", description: "Navigate accounts" },
    { key: "r", description: "Refresh" },
  ]},
  council: { title: "Council Panel", shortcuts: [
    { key: "j/k", description: "Navigate analyses" },
    { key: "Enter", description: "View detail" },
    { key: "r", description: "Refresh" },
  ]},
  verify: { title: "Verification View", shortcuts: [
    { key: "j/k", description: "Navigate results" },
    { key: "Enter", description: "View detail" },
    { key: "r", description: "Refresh" },
  ]},
  entire: { title: "Entire Sessions", shortcuts: [
    { key: "j/k", description: "Navigate sessions" },
    { key: "r", description: "Refresh" },
  ]},
  chains: { title: "Delegation Chains", shortcuts: [
    { key: "j/k", description: "Navigate chains" },
    { key: "r", description: "Refresh" },
  ]},
  streams: { title: "Agent Activity", shortcuts: [
    { key: "j/k", description: "Navigate agents" },
    { key: "PgUp/PgDn", description: "Scroll output" },
    { key: "f", description: "Follow (auto-scroll)" },
  ]},
  chat: { title: "Chat", shortcuts: [
    { key: "Enter", description: "Send message / focus input" },
    { key: "Esc", description: "Toggle browse mode / back" },
    { key: "Tab", description: "Switch account" },
    { key: "Ctrl+O", description: "Account picker" },
    { key: "Ctrl+E", description: "Session picker" },
    { key: "/", description: "Slash commands" },
    { key: "j/k", description: "Scroll messages (browse mode)" },
    { key: "f", description: "Follow (auto-scroll)" },
    { key: "c", description: "Clear conversation (browse mode)" },
    { key: "Ctrl+C", description: "Abort streaming response" },
  ]},
};

export function HelpOverlay() {
  const { colors } = useTheme();
  const route = useRoute();
  const nav = useNav();

  const groups = () => {
    const result = [GLOBAL_SHORTCUTS, NAV_SHORTCUTS];
    const viewGroup = VIEW_SHORTCUTS[route.data.type];
    if (viewGroup) result.push(viewGroup);
    return result;
  };

  return (
    <Show when={nav.helpOpen}>
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        marginTop={1}
        marginBottom={1}
      >
        <text attributes={TextAttributes.BOLD} fg={colors.warning}>Keyboard Shortcuts</text>
        <text fg={colors.textMuted}>Press ? or Esc to close</text>
        <text> </text>
        <For each={groups()}>
          {(group) => (
            <box flexDirection="column" marginBottom={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.primary}>{group.title}</text>
              <For each={group.shortcuts}>
                {(s) => (
                  <box flexDirection="row" marginLeft={2}>
                    <text fg={colors.text} attributes={TextAttributes.BOLD}>{s.key.padEnd(12)}</text>
                    <text fg={colors.textMuted}>{s.description}</text>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}
