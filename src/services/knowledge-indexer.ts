import type { KnowledgeStore } from "../daemon/knowledge-store";
import type { TaskBoard } from "./tasks";

export function indexExistingPrompts(
  store: KnowledgeStore,
  prompts: Array<{ id: string; title: string; content: string; tags?: string[] }>
): number {
  let count = 0;
  for (const prompt of prompts) {
    store.index({
      category: "prompt",
      title: prompt.title,
      content: prompt.content,
      tags: prompt.tags ?? [],
      sourceId: prompt.id,
    });
    count++;
  }
  return count;
}

export function indexExistingHandoffs(
  store: KnowledgeStore,
  messages: Array<{ id: string; type: string; from: string; to: string; content: string; context?: any }>
): number {
  let count = 0;
  for (const msg of messages) {
    if (msg.type !== "handoff") continue;
    store.index({
      category: "handoff",
      title: `Handoff from ${msg.from} to ${msg.to}`,
      content: msg.content,
      tags: [],
      sourceId: msg.id,
    });
    count++;
  }
  return count;
}

export function indexTaskEvents(store: KnowledgeStore, board: TaskBoard): number {
  let count = 0;
  for (const task of board.tasks) {
    for (const event of task.events) {
      store.index({
        category: "task_event",
        title: `Task '${task.title}' - ${event.type}`,
        content: JSON.stringify(event),
        tags: [],
        sourceId: task.id,
        accountName: task.assignee,
      });
      count++;
    }
  }
  return count;
}
