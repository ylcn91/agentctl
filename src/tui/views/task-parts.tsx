import { Show, For } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { calculateProviderFit } from "../../services/provider-profiles.js";
import type { TaskStatus } from "../../services/tasks.js";

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  priority?: string;
  dueDate?: string;
  tags?: string[];
}

interface ThemeColors {
  text: string;
  textMuted: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  needs_review: "Needs Review",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function TaskListGroup(props: {
  status: TaskStatus;
  tasks: Task[];
  flatTasks: Task[];
  selectedIndex: number;
  isBrowsing: boolean;
  statusColor: string;
  colors: ThemeColors;
}) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <text attributes={TextAttributes.BOLD} fg={props.statusColor}>{STATUS_LABELS[props.status]} ({props.tasks.length})</text>
      <For each={props.tasks}>
        {(task) => {
          const globalIdx = () => props.flatTasks.indexOf(task);
          const isSelected = () => globalIdx() === props.selectedIndex && props.isBrowsing;
          return (
            <box marginLeft={2}>
              <text fg={isSelected() ? props.colors.text : props.colors.textMuted}>{isSelected() ? "> " : "  "}</text>
              <text fg={isSelected() ? props.colors.text : undefined}>
                <Show when={task.priority}><text fg={props.colors.error}>[{task.priority}] </text></Show>
                {task.title}
              </text>
              <Show when={task.dueDate}><text fg={props.colors.textMuted}> due:{task.dueDate!.slice(0, 10)}</text></Show>
              <Show when={task.tags && task.tags.length > 0}><text fg={props.colors.info}> #{(task.tags ?? []).join(" #")}</text></Show>
              <Show when={task.assignee}><text fg={props.colors.secondary}> @{task.assignee}</text></Show>
            </box>
          );
        }}
      </For>
      <Show when={props.tasks.length === 0}>
        <box marginLeft={2}><text fg={props.colors.textMuted}>  (empty)</text></box>
      </Show>
    </box>
  );
}

export function AssignPanel(props: {
  task: Task;
  accounts: string[];
  assignIndex: number;
  colors: ThemeColors;
}) {
  const requiredSkills = () => (props.task.tags ?? [])
    .filter((t) => t.startsWith("skill:"))
    .map((t) => t.split(":")[1]);

  return (
    <box flexDirection="column" marginTop={1}>
      <text attributes={TextAttributes.BOLD} fg={props.colors.primary}>Assign to:</text>
      <For each={props.accounts}>
        {(acct, i) => {
          const fitScore = () => calculateProviderFit(acct, requiredSkills());
          const scoreColor = () => fitScore() > 70 ? props.colors.success : fitScore() >= 40 ? props.colors.warning : props.colors.error;
          return (
            <box marginLeft={2}>
              <text fg={i() === props.assignIndex ? props.colors.text : props.colors.textMuted}>
                {i() === props.assignIndex ? "> " : "  "}{acct}
              </text>
              <Show when={requiredSkills().length > 0}>
                <text fg={scoreColor()}> ({fitScore()}%)</text>
              </Show>
            </box>
          );
        }}
      </For>
    </box>
  );
}

export function TextInputBar(props: {
  label: string;
  value: string;
  labelColor: string;
  cursorColor: string;
}) {
  return (
    <box marginBottom={1}>
      <text fg={props.labelColor}>{props.label}</text>
      <text>{props.value}</text>
      <text fg={props.cursorColor}>_</text>
    </box>
  );
}
