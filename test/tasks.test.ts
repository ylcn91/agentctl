import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
  loadTasks,
  saveTasks,
  addTask,
  updateTaskStatus,
  assignTask,
  removeTask,
  rejectTask,
  submitForReview,
  REJECTION_ESCALATION_THRESHOLD,
} from "../src/services/tasks";

const TEST_DIR = join(import.meta.dir, ".test-tasks");
const TEST_TASKS_PATH = join(TEST_DIR, "tasks.json");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("tasks service", () => {
  test("loadTasks returns empty board when no file exists", async () => {
    const board = await loadTasks(TEST_TASKS_PATH);
    expect(board.tasks).toEqual([]);
  });

  test("addTask creates a new todo task", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Implement auth module");
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0].title).toBe("Implement auth module");
    expect(board.tasks[0].status).toBe("todo");
    expect(board.tasks[0].assignee).toBeUndefined();
    expect(board.tasks[0].id).toBeDefined();
  });

  test("saveTasks and loadTasks round-trip", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Task A");
    board = addTask(board, "Task B");
    await saveTasks(board, TEST_TASKS_PATH);

    const loaded = await loadTasks(TEST_TASKS_PATH);
    expect(loaded.tasks).toHaveLength(2);
    expect(loaded.tasks[0].title).toBe("Task A");
    expect(loaded.tasks[1].title).toBe("Task B");
  });

  test("updateTaskStatus changes status through valid transitions", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Deploy to staging");
    const taskId = board.tasks[0].id;

    board = updateTaskStatus(board, taskId, "in_progress");
    expect(board.tasks[0].status).toBe("in_progress");

    board = updateTaskStatus(board, taskId, "ready_for_review");
    expect(board.tasks[0].status).toBe("ready_for_review");
  });

  test("assignTask sets assignee", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Write tests");
    const taskId = board.tasks[0].id;

    board = assignTask(board, taskId, "claude-work");
    expect(board.tasks[0].assignee).toBe("claude-work");
  });

  test("assignTask clears assignee with undefined", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Write tests");
    const taskId = board.tasks[0].id;

    board = assignTask(board, taskId, "claude-work");
    board = assignTask(board, taskId, undefined);
    expect(board.tasks[0].assignee).toBeUndefined();
  });

  test("removeTask deletes a task by id", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Task A");
    board = addTask(board, "Task B");
    const idToRemove = board.tasks[0].id;

    board = removeTask(board, idToRemove);
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0].title).toBe("Task B");
  });

  test("updateTaskStatus on nonexistent task throws", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Only task");

    expect(() => updateTaskStatus(board, "nonexistent-id", "in_progress")).toThrow("not found");
  });

  test("tasks preserve createdAt timestamp", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Timestamped task");
    expect(board.tasks[0].createdAt).toBeDefined();

    await saveTasks(board, TEST_TASKS_PATH);
    const loaded = await loadTasks(TEST_TASKS_PATH);
    expect(loaded.tasks[0].createdAt).toBe(board.tasks[0].createdAt);
  });

  test("rejectTask increments rejectionCount", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Rejectable task");
    const id = board.tasks[0].id;
    board = updateTaskStatus(board, id, "in_progress");
    board = submitForReview(board, id);
    board = rejectTask(board, id, "needs work");
    expect(board.tasks[0].rejectionCount).toBe(1);
    expect(board.tasks[0].status).toBe("in_progress");
  });

  test("rejectTask escalates to needs_review after threshold", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Escalatable task");
    const id = board.tasks[0].id;

    board = updateTaskStatus(board, id, "in_progress");
    for (let i = 0; i < REJECTION_ESCALATION_THRESHOLD; i++) {
      board = submitForReview(board, id);
      board = rejectTask(board, id, `rejection ${i + 1}`);
    }

    expect(board.tasks[0].rejectionCount).toBe(REJECTION_ESCALATION_THRESHOLD);
    expect(board.tasks[0].status).toBe("needs_review");
    // Verify escalation event was recorded
    const escalatedEvent = board.tasks[0].events.find((e) => e.type === "escalated");
    expect(escalatedEvent).toBeDefined();
    expect(escalatedEvent!.reason).toContain(`Rejected ${REJECTION_ESCALATION_THRESHOLD} times`);
  });

  test("rejectTask bounces to in_progress before threshold", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Pre-threshold task");
    const id = board.tasks[0].id;

    board = updateTaskStatus(board, id, "in_progress");
    board = submitForReview(board, id);
    board = rejectTask(board, id, "first rejection");
    expect(board.tasks[0].status).toBe("in_progress");
    expect(board.tasks[0].rejectionCount).toBe(1);

    board = submitForReview(board, id);
    board = rejectTask(board, id, "second rejection");
    expect(board.tasks[0].status).toBe("in_progress");
    expect(board.tasks[0].rejectionCount).toBe(2);
  });

  test("needs_review can transition to in_progress or accepted", async () => {
    let board = await loadTasks(TEST_TASKS_PATH);
    board = addTask(board, "Needs review task");
    const id = board.tasks[0].id;

    // Fast-track to needs_review
    board = updateTaskStatus(board, id, "in_progress");
    for (let i = 0; i < REJECTION_ESCALATION_THRESHOLD; i++) {
      board = submitForReview(board, id);
      board = rejectTask(board, id, `rejection ${i + 1}`);
    }
    expect(board.tasks[0].status).toBe("needs_review");

    // Can transition back to in_progress
    board = updateTaskStatus(board, id, "in_progress");
    expect(board.tasks[0].status).toBe("in_progress");
  });
});
