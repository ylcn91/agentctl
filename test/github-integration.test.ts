import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("github integration exports", () => {
  test("createIssue is an exported async function", async () => {
    const { createIssue } = await import("../src/integrations/github");
    expect(typeof createIssue).toBe("function");
  });

  test("commentOnIssue is an exported async function", async () => {
    const { commentOnIssue } = await import("../src/integrations/github");
    expect(typeof commentOnIssue).toBe("function");
  });

  test("commentOnPR is an exported async function", async () => {
    const { commentOnPR } = await import("../src/integrations/github");
    expect(typeof commentOnPR).toBe("function");
  });

  test("closeIssue is an exported async function", async () => {
    const { closeIssue } = await import("../src/integrations/github");
    expect(typeof closeIssue).toBe("function");
  });

  test("getIssueStatus is an exported async function", async () => {
    const { getIssueStatus } = await import("../src/integrations/github");
    expect(typeof getIssueStatus).toBe("function");
  });
});

describe("integration-hooks parseExternalId", () => {
  test("parses owner/repo#123 format correctly", async () => {
    const { parseExternalId } = await import("../src/services/integration-hooks");
    const result = parseExternalId("myorg/myrepo#42");
    expect(result.owner).toBe("myorg");
    expect(result.repo).toBe("myrepo");
    expect(result.number).toBe(42);
  });

  test("parses nested repo paths", async () => {
    const { parseExternalId } = await import("../src/services/integration-hooks");
    const result = parseExternalId("owner/complex-repo-name#999");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("complex-repo-name");
    expect(result.number).toBe(999);
  });

  test("throws on invalid format without hash", async () => {
    const { parseExternalId } = await import("../src/services/integration-hooks");
    expect(() => parseExternalId("owner/repo")).toThrow("Invalid externalId format");
  });

  test("throws on invalid format without slash", async () => {
    const { parseExternalId } = await import("../src/services/integration-hooks");
    expect(() => parseExternalId("ownerrepo#123")).toThrow("Invalid externalId format");
  });
});

describe("integration-hooks onTaskStatusChanged", () => {
  const TEST_DIR = join(import.meta.dir, ".test-integration-hooks");

  test("does not throw with no links", async () => {
    process.env.CLAUDE_HUB_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });

    try {
      const { onTaskStatusChanged } = await import("../src/services/integration-hooks");
      // Should not throw even with no links file
      await onTaskStatusChanged("nonexistent-task", "accepted");
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
      delete process.env.CLAUDE_HUB_DIR;
    }
  });
});
