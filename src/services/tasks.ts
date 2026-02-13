import { atomicWrite, atomicRead } from "./file-store";

export type TaskStatus = "pending" | "in-progress" | "done";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string;
}

export interface TaskBoard {
  tasks: Task[];
}

const EMPTY_BOARD: TaskBoard = { tasks: [] };

function getTasksPath(): string {
  const hubDir = process.env.CLAUDE_HUB_DIR ?? `${process.env.HOME}/.claude-hub`;
  return `${hubDir}/tasks.json`;
}

export async function loadTasks(path?: string): Promise<TaskBoard> {
  const tasksPath = path ?? getTasksPath();
  const raw = await atomicRead<TaskBoard>(tasksPath);
  if (!raw || !Array.isArray(raw.tasks)) return { ...EMPTY_BOARD };
  return raw;
}

export async function saveTasks(board: TaskBoard, path?: string): Promise<void> {
  const tasksPath = path ?? getTasksPath();
  await atomicWrite(tasksPath, board);
}

export function addTask(board: TaskBoard, title: string, assignee?: string): TaskBoard {
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    status: "pending",
    assignee,
    createdAt: new Date().toISOString(),
  };
  return { tasks: [...board.tasks, task] };
}

export function updateTaskStatus(board: TaskBoard, id: string, status: TaskStatus): TaskBoard {
  return {
    tasks: board.tasks.map((t) => (t.id === id ? { ...t, status } : t)),
  };
}

export function assignTask(board: TaskBoard, id: string, assignee: string | undefined): TaskBoard {
  return {
    tasks: board.tasks.map((t) => (t.id === id ? { ...t, assignee } : t)),
  };
}

export function removeTask(board: TaskBoard, id: string): TaskBoard {
  return { tasks: board.tasks.filter((t) => t.id !== id) };
}
