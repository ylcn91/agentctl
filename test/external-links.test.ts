import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-external-links");

beforeEach(() => {
  process.env.CLAUDE_HUB_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.CLAUDE_HUB_DIR;
});

describe("external-links service", () => {
  test("addLink creates a link with ID and timestamp", async () => {
    const { addLink } = await import("../src/services/external-links");
    const link = await addLink({
      provider: "github",
      type: "issue",
      url: "https://github.com/owner/repo/issues/1",
      externalId: "owner/repo#1",
      taskId: "task-123",
    });
    expect(link.id).toBeDefined();
    expect(link.createdAt).toBeDefined();
    expect(link.provider).toBe("github");
    expect(link.type).toBe("issue");
    expect(link.taskId).toBe("task-123");
    expect(link.externalId).toBe("owner/repo#1");
  });

  test("getLinksForTask filters by taskId", async () => {
    const { addLink, getLinksForTask } = await import("../src/services/external-links");
    await addLink({
      provider: "github",
      type: "issue",
      url: "https://github.com/owner/repo/issues/1",
      externalId: "owner/repo#1",
      taskId: "task-a",
    });
    await addLink({
      provider: "github",
      type: "pr",
      url: "https://github.com/owner/repo/pull/2",
      externalId: "owner/repo#2",
      taskId: "task-b",
    });
    await addLink({
      provider: "github",
      type: "issue",
      url: "https://github.com/owner/repo/issues/3",
      externalId: "owner/repo#3",
      taskId: "task-a",
    });

    const linksA = await getLinksForTask("task-a");
    expect(linksA).toHaveLength(2);
    expect(linksA.every((l) => l.taskId === "task-a")).toBe(true);

    const linksB = await getLinksForTask("task-b");
    expect(linksB).toHaveLength(1);
    expect(linksB[0].type).toBe("pr");
  });

  test("getAllLinks returns all links", async () => {
    const { addLink, getAllLinks } = await import("../src/services/external-links");
    await addLink({
      provider: "github",
      type: "issue",
      url: "https://github.com/a/b/issues/1",
      externalId: "a/b#1",
      taskId: "t1",
    });
    await addLink({
      provider: "github",
      type: "pr",
      url: "https://github.com/c/d/pull/2",
      externalId: "c/d#2",
      taskId: "t2",
    });

    const all = await getAllLinks();
    expect(all).toHaveLength(2);
  });

  test("removeLink removes and returns true", async () => {
    const { addLink, removeLink, getAllLinks } = await import("../src/services/external-links");
    const link = await addLink({
      provider: "github",
      type: "issue",
      url: "https://github.com/a/b/issues/1",
      externalId: "a/b#1",
      taskId: "t1",
    });

    const removed = await removeLink(link.id);
    expect(removed).toBe(true);

    const all = await getAllLinks();
    expect(all).toHaveLength(0);
  });

  test("removeLink returns false for missing ID", async () => {
    const { removeLink } = await import("../src/services/external-links");
    const removed = await removeLink("nonexistent-id");
    expect(removed).toBe(false);
  });

  test("handles missing file gracefully", async () => {
    const { getLinksForTask, getAllLinks } = await import("../src/services/external-links");
    const links = await getLinksForTask("no-such-task");
    expect(links).toEqual([]);

    const all = await getAllLinks();
    expect(all).toEqual([]);
  });
});
