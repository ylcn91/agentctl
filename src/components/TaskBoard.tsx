import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import {
  loadTasks,
  saveTasks,
  addTask,
  updateTaskStatus,
  assignTask,
  removeTask,
  type Task,
  type TaskBoard as TaskBoardData,
  type TaskStatus,
} from "../services/tasks.js";

interface Props {
  onNavigate: (view: string) => void;
  accounts?: string[];
}

type Mode = "browse" | "add" | "assign";

const STATUS_ORDER: TaskStatus[] = ["pending", "in-progress", "done"];
const STATUS_COLORS: Record<TaskStatus, string> = {
  "pending": "yellow",
  "in-progress": "cyan",
  "done": "green",
};
const STATUS_LABELS: Record<TaskStatus, string> = {
  "pending": "Pending",
  "in-progress": "In Progress",
  "done": "Done",
};

export function TaskBoard({ onNavigate, accounts = [] }: Props) {
  const [board, setBoard] = useState<TaskBoardData>({ tasks: [] });
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("browse");
  const [inputBuffer, setInputBuffer] = useState("");
  const [assignIndex, setAssignIndex] = useState(0);

  useEffect(() => {
    loadTasks().then((b) => {
      setBoard(b);
      setLoading(false);
    });
  }, []);

  const allTasks = board.tasks;
  const tasksByStatus = (status: TaskStatus) =>
    allTasks.filter((t) => t.status === status);

  // Flat list for navigation: pending, then in-progress, then done
  const flatTasks = STATUS_ORDER.flatMap((s) => tasksByStatus(s));

  async function persist(newBoard: TaskBoardData) {
    setBoard(newBoard);
    await saveTasks(newBoard);
  }

  useInput((input, key) => {
    if (mode === "add") {
      if (key.return) {
        if (inputBuffer.trim()) {
          const newBoard = addTask(board, inputBuffer.trim());
          persist(newBoard);
        }
        setInputBuffer("");
        setMode("browse");
      } else if (key.escape) {
        setInputBuffer("");
        setMode("browse");
      } else if (key.backspace || key.delete) {
        setInputBuffer((b) => b.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setInputBuffer((b) => b + input);
      }
      return;
    }

    if (mode === "assign") {
      if (key.return && accounts.length > 0) {
        const task = flatTasks[selectedIndex];
        if (task) {
          const newBoard = assignTask(board, task.id, accounts[assignIndex]);
          persist(newBoard);
        }
        setMode("browse");
      } else if (key.escape) {
        setMode("browse");
      } else if (key.upArrow) {
        setAssignIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setAssignIndex((i) => Math.min(accounts.length - 1, i + 1));
      }
      return;
    }

    // Browse mode
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(flatTasks.length - 1, i + 1));
    } else if (input === "a") {
      setMode("add");
    } else if (key.return && flatTasks[selectedIndex]) {
      if (accounts.length > 0) {
        setAssignIndex(0);
        setMode("assign");
      }
    } else if (input === "d" && flatTasks[selectedIndex]) {
      const task = flatTasks[selectedIndex];
      const newBoard = removeTask(board, task.id);
      persist(newBoard);
      setSelectedIndex((i) => Math.min(i, newBoard.tasks.length - 1));
    } else if (input === "s" && flatTasks[selectedIndex]) {
      // Cycle status: pending -> in-progress -> done -> pending
      const task = flatTasks[selectedIndex];
      const nextIdx = (STATUS_ORDER.indexOf(task.status) + 1) % STATUS_ORDER.length;
      const newBoard = updateTaskStatus(board, task.id, STATUS_ORDER[nextIdx]);
      persist(newBoard);
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color="gray">Loading tasks...</Text>;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Task Board</Text>
        <Text color="gray">  [a]dd [s]tatus [Enter]assign [d]elete [Esc]back</Text>
      </Box>

      {mode === "add" && (
        <Box marginBottom={1}>
          <Text color="cyan">New task: </Text>
          <Text>{inputBuffer}</Text>
          <Text color="gray">_</Text>
        </Box>
      )}

      {STATUS_ORDER.map((status) => {
        const tasks = tasksByStatus(status);
        return (
          <Box key={status} flexDirection="column" marginBottom={1}>
            <Text bold color={STATUS_COLORS[status]}>
              {STATUS_LABELS[status]} ({tasks.length})
            </Text>
            {tasks.map((task) => {
              const globalIdx = flatTasks.indexOf(task);
              const isSelected = globalIdx === selectedIndex && mode === "browse";
              return (
                <Box key={task.id} marginLeft={2}>
                  <Text color={isSelected ? "white" : "gray"}>
                    {isSelected ? "> " : "  "}
                  </Text>
                  <Text color={isSelected ? "white" : undefined}>
                    {task.title}
                  </Text>
                  {task.assignee && (
                    <Text color="magenta"> @{task.assignee}</Text>
                  )}
                </Box>
              );
            })}
            {tasks.length === 0 && (
              <Box marginLeft={2}>
                <Text color="gray" dimColor>  (empty)</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {mode === "assign" && flatTasks[selectedIndex] && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">Assign to:</Text>
          {accounts.map((acct, i) => (
            <Box key={acct} marginLeft={2}>
              <Text color={i === assignIndex ? "white" : "gray"}>
                {i === assignIndex ? "> " : "  "}{acct}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
