import { createSignal, createEffect, on, onMount, onCleanup, Show, For, createMemo, type Accessor } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import {
  loadTasks, saveTasks, addTask, updateTaskStatus, assignTask,
  removeTask, sortByPriority, rejectTask, acceptTask, VALID_TRANSITIONS,
  type TaskBoard as TaskBoardData, type TaskStatus,
} from "../../services/tasks.js";
import { getGatedAcceptanceAction } from "../../services/cognitive-friction.js";
import type { HandoffPayload } from "../../services/handoff.js";
import { calculateProviderFit } from "../../services/provider-profiles.js";
import { loadConfig } from "../../config.js";

type Mode = "browse" | "add" | "assign" | "reject" | "justify" | "search";
const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "ready_for_review", "accepted", "rejected"];

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  needs_review: "Needs Review",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function TaskBoard() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const [board, setBoard] = createSignal<TaskBoardData>({ tasks: [] });
  const [loading, setLoading] = createSignal(true);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [mode, setMode] = createSignal<Mode>("browse");
  const [inputBuffer, setInputBuffer] = createSignal("");
  const [assignIndex, setAssignIndex] = createSignal(0);
  const [sortByPrio, setSortByPrio] = createSignal(false);
  const [frictionMessage, setFrictionMessage] = createSignal<{ text: string; color: string | RGBA } | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [accounts, setAccounts] = createSignal<string[]>([]);

  const STATUS_COLORS: Record<TaskStatus, string | RGBA> = {
    todo: colors.warning,
    in_progress: colors.primary,
    ready_for_review: colors.secondary,
    needs_review: colors.info,
    accepted: colors.success,
    rejected: colors.error,
  };

  onMount(() => {
    nav.setInputFocus("view");
  });
  onCleanup(() => {
    nav.setInputFocus("global");
  });

  onMount(() => {
    loadTasks().then((b) => { setBoard(b); setLoading(false); });
    loadConfig().then((c) => setAccounts(c.accounts.map(a => a.name))).catch(() => {});
  });

  const interval = setInterval(() => {
    loadTasks().then((b) => setBoard(b)).catch(() => {});
  }, 3000);
  onCleanup(() => clearInterval(interval));

  function tasksByStatus(status: TaskStatus) {
    return board().tasks.filter((t) => t.status === status);
  }

  function getFlatTasks() {
    const raw = STATUS_ORDER.flatMap((s) => tasksByStatus(s));
    const sq = searchQuery();
    const searched = sq
      ? raw.filter((t) => {
          const q = sq.toLowerCase();
          return t.title.toLowerCase().includes(q) ||
            (t.assignee ?? "").toLowerCase().includes(q) ||
            (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
        })
      : raw;
    return sortByPrio() ? sortByPriority(searched) : searched;
  }

  async function persist(newBoard: TaskBoardData) {
    setBoard(newBoard);
    await saveTasks(newBoard);
  }

  function commitInput(currentMode: Mode, value: string) {
    const flatTasks = getFlatTasks();
    if (currentMode === "add") {
      persist(addTask(board(), value));
    } else if (currentMode === "reject") {
      const task = flatTasks[selectedIndex()];
      if (task) persist(rejectTask(board(), task.id, value));
    } else if (currentMode === "justify") {
      const task = flatTasks[selectedIndex()];
      if (task) {
        try {
          persist(acceptTask(board(), task.id, value));
          setFrictionMessage({ text: "Accepted with justification", color: colors.success });
        } catch {}
      }
    }
  }

  function handleAcceptAction(task: any) {
    if (task.status !== "ready_for_review") return;
    const taskTags = task.tags ?? [];
    const payload: Partial<HandoffPayload> = { goal: task.title, acceptance_criteria: [], run_commands: [], blocked_by: [] };
    for (const tag of taskTags) {
      if (tag.startsWith("criticality:")) payload.criticality = tag.split(":")[1] as any;
      if (tag.startsWith("reversibility:")) payload.reversibility = tag.split(":")[1] as any;
      if (tag.startsWith("verifiability:")) payload.verifiability = tag.split(":")[1] as any;
    }
    const gateResult = getGatedAcceptanceAction(payload as HandoffPayload);
    if (gateResult.action === "auto-accept") {
      try { persist(acceptTask(board(), task.id)); setFrictionMessage({ text: "Auto-accepted", color: colors.success }); setTimeout(() => setFrictionMessage(null), 3000); } catch {}
    } else if (gateResult.action === "require-acceptance") {
      try { persist(acceptTask(board(), task.id)); } catch {}
    } else if (gateResult.action === "require-justification") {
      setInputBuffer(""); setMode("justify");
    } else if (gateResult.action === "require-elevated-review") {
      setFrictionMessage({ text: `BLOCKED: ${gateResult.reason}`, color: colors.error }); setTimeout(() => setFrictionMessage(null), 5000);
    }
  }

  useKeyboard((evt: any) => {
    if (nav.inputFocus !== "view") return;
    const m = mode();
    const flatTasks = getFlatTasks();

    if (m === "search") {
      if (evt.name === "return" || evt.name === "escape") {
        if (evt.name === "escape") setSearchQuery("");
        setMode("browse");
        setSelectedIndex(0);
      } else if (evt.name === "backspace") {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) {
        setSearchQuery((q) => q + evt.name);
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (m === "add" || m === "reject" || m === "justify") {
      if (evt.name === "return") {
        if (inputBuffer().trim()) commitInput(m, inputBuffer().trim());
        setInputBuffer("");
        setMode("browse");
      } else if (evt.name === "escape") {
        setInputBuffer("");
        setMode("browse");
      } else if (evt.name === "backspace") {
        setInputBuffer((b) => b.slice(0, -1));
      } else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) {
        setInputBuffer((b) => b + evt.name);
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (m === "assign") {
      const accts = accounts();
      if (evt.name === "return" && accts.length > 0) {
        const task = flatTasks[selectedIndex()];
        if (task) persist(assignTask(board(), task.id, accts[assignIndex()]));
        setMode("browse");
      } else if (evt.name === "escape") {
        setMode("browse");
      } else if (evt.name === "up") {
        setAssignIndex((i) => Math.max(0, i - 1));
      } else if (evt.name === "down") {
        setAssignIndex((i) => Math.min(accts.length - 1, i + 1));
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (evt.name === "up" || evt.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (evt.name === "down" || evt.name === "j") {
      setSelectedIndex((i) => Math.min(flatTasks.length - 1, i + 1));
    } else if (evt.name === "/") {
      setMode("search");
    } else if (evt.name === "a") {
      setMode("add");
    } else if (evt.name === "return" && flatTasks[selectedIndex()]) {
      if (accounts().length > 0) { setAssignIndex(0); setMode("assign"); }
    } else if (evt.name === "d" && flatTasks[selectedIndex()]) {
      const task = flatTasks[selectedIndex()];
      const nb = removeTask(board(), task.id);
      persist(nb);
      setSelectedIndex((i) => Math.min(i, nb.tasks.length - 1));
    } else if (evt.name === "s" && !evt.ctrl && flatTasks[selectedIndex()]) {
      const task = flatTasks[selectedIndex()];
      const allowed = VALID_TRANSITIONS[task.status];
      if (allowed.length > 0) {
        try { persist(updateTaskStatus(board(), task.id, allowed[0])); } catch {}
      }
    } else if (evt.name === "v" && flatTasks[selectedIndex()]) {
      handleAcceptAction(flatTasks[selectedIndex()]);
    } else if (evt.name === "x" && flatTasks[selectedIndex()]) {
      const task = flatTasks[selectedIndex()];
      if (task.status === "ready_for_review") setMode("reject");
    } else if (evt.name === "p") {
      setSortByPrio((prev) => !prev);
    } else if (evt.name === "escape") {
      route.navigate({ type: "dashboard" });
    } else {
      return;
    }
    evt.preventDefault(); evt.stopPropagation();
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading tasks...</text>}>
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>Task Board</text>
          <Show when={sortByPrio()}><text fg={colors.warning}> (sorted by priority)</text></Show>
          <Show when={searchQuery()}><text fg={colors.primary}> filter: "{searchQuery()}"</text></Show>
          <text fg={colors.textMuted}>  [/]search [a]dd [s]tatus [v]accept [x]reject [p]riority [Enter]assign [d]elete [Esc]back</text>
        </box>

        <Show when={mode() === "search"}>
          <box flexDirection="row" marginBottom={1}><text fg={colors.primary}>Search: </text><text>{searchQuery()}</text><text fg={colors.textMuted}>_</text></box>
        </Show>
        <Show when={mode() === "add"}>
          <box flexDirection="row" marginBottom={1}><text fg={colors.primary}>New task: </text><text>{inputBuffer()}</text><text fg={colors.textMuted}>_</text></box>
        </Show>
        <Show when={mode() === "reject"}>
          <box flexDirection="row" marginBottom={1}><text fg={colors.error}>Rejection reason: </text><text>{inputBuffer()}</text><text fg={colors.textMuted}>_</text></box>
        </Show>
        <Show when={mode() === "justify"}>
          <box flexDirection="row" marginBottom={1}><text fg={colors.warning}>Justification required: </text><text>{inputBuffer()}</text><text fg={colors.textMuted}>_</text></box>
        </Show>

        <Show when={frictionMessage()}>
          {(msg: Accessor<{ text: string; color: string | RGBA }>) => <box marginBottom={1}><text fg={msg().color}>{msg().text}</text></box>}
        </Show>

        <For each={STATUS_ORDER}>
          {(status) => {
            const tasks = () => tasksByStatus(status);
            const taskIndexMap = createMemo(() => {
              const map = new Map<string, number>();
              getFlatTasks().forEach((t, i) => map.set(t.id, i));
              return map;
            });
            return (
              <box flexDirection="column" marginBottom={1}>
                <text attributes={TextAttributes.BOLD} fg={STATUS_COLORS[status]}>{STATUS_LABELS[status]} ({tasks().length})</text>
                <For each={tasks()}>
                  {(task) => {
                    const globalIdx = () => taskIndexMap().get(task.id) ?? -1;
                    const isSelected = () => globalIdx() === selectedIndex() && mode() === "browse";
                    return (
                      <box flexDirection="row" marginLeft={2}>
                        <text fg={isSelected() ? colors.text : colors.textMuted}>{isSelected() ? "> " : "  "}</text>
                        <text fg={isSelected() ? colors.text : undefined}>
                          {task.priority && <text fg={colors.error}>[{task.priority}] </text>}
                          {task.title}
                        </text>
                        <Show when={task.dueDate}><text fg={colors.textMuted}> due:{task.dueDate!.slice(0, 10)}</text></Show>
                        <Show when={task.tags && task.tags.length > 0}><text fg={colors.info}> #{(task.tags ?? []).join(" #")}</text></Show>
                        <Show when={task.assignee}><text fg={colors.secondary}> @{task.assignee}</text></Show>
                      </box>
                    );
                  }}
                </For>
                <Show when={tasks().length === 0}>
                  <box marginLeft={2}><text fg={colors.textMuted}>  (empty)</text></box>
                </Show>
              </box>
            );
          }}
        </For>

        <Show when={mode() === "assign" && getFlatTasks()[selectedIndex()]}>
          <box flexDirection="column" marginTop={1}>
            <text attributes={TextAttributes.BOLD} fg={colors.primary}>Assign to:</text>
            <For each={accounts()}>
              {(acct, idx) => (
                <box marginLeft={2}>
                  <text fg={idx() === assignIndex() ? colors.text : colors.textMuted}>
                    {idx() === assignIndex() ? "> " : "  "}{acct}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </box>
    </Show>
  );
}
