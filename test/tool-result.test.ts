import { test, expect, describe } from "bun:test";
import { type ToolResult, formatToolSummary, executeTool } from "../src/services/anthropic-tools";

describe("ToolResult interface", () => {
  test("has expected shape", () => {
    const result: ToolResult = {
      name: "read_file",
      title: "src/app.tsx",
      input: "src/app.tsx",
      output: "const App = () => ...",
      durationMs: 5,
      truncated: false,
      is_error: false,
    };
    expect(result.name).toBe("read_file");
    expect(result.title).toBe("src/app.tsx");
    expect(result.exitCode).toBeUndefined();
  });

  test("bash results include exitCode", () => {
    const result: ToolResult = {
      name: "bash",
      title: "echo hello",
      input: "echo hello",
      output: "hello\n",
      exitCode: 0,
      durationMs: 10,
      truncated: false,
      is_error: false,
    };
    expect(result.exitCode).toBe(0);
  });
});

describe("formatToolSummary", () => {
  test("formats successful short result", () => {
    const result: ToolResult = {
      name: "read_file",
      title: "src/app.tsx",
      input: "src/app.tsx",
      output: "content",
      durationMs: 3,
      truncated: false,
      is_error: false,
    };
    const summary = formatToolSummary(result);
    expect(summary).toContain("read_file:");
    expect(summary).toContain("src/app.tsx");
    expect(summary).toContain("[ok]");
    expect(summary).not.toContain("[truncated]");
  });

  test("formats error result", () => {
    const result: ToolResult = {
      name: "read_file",
      title: "missing.ts (not found)",
      input: "missing.ts",
      output: "Error: File not found: missing.ts",
      durationMs: 1,
      truncated: false,
      is_error: true,
    };
    const summary = formatToolSummary(result);
    expect(summary).toContain("[ERR]");
    expect(summary).toContain("read_file:");
  });

  test("formats truncated result", () => {
    const result: ToolResult = {
      name: "bash",
      title: "cat bigfile.log",
      input: "cat bigfile.log",
      output: "X".repeat(60000),
      exitCode: 0,
      durationMs: 50,
      truncated: true,
      is_error: false,
    };
    const summary = formatToolSummary(result);
    expect(summary).toContain("[truncated]");
    expect(summary).toContain("[ok]");
  });

  test("shows KB for large outputs", () => {
    const result: ToolResult = {
      name: "grep",
      title: "error (42 matches)",
      input: "error",
      output: "X".repeat(2048),
      durationMs: 15,
      truncated: false,
      is_error: false,
    };
    const summary = formatToolSummary(result);
    expect(summary).toContain("KB");
  });

  test("shows B for small outputs", () => {
    const result: ToolResult = {
      name: "list_dir",
      title: "/tmp (3 entries)",
      input: "/tmp",
      output: "d foo\nf bar\nf baz",
      durationMs: 2,
      truncated: false,
      is_error: false,
    };
    const summary = formatToolSummary(result);
    expect(summary).toContain("B)");
  });
});

describe("executeTool structured results", () => {
  test("read_file returns ToolResult with title as path", async () => {
    const tmpPath = "/tmp/tool-result-test.txt";
    await Bun.write(tmpPath, "hello world\n");

    const result = await executeTool("read_file", { path: tmpPath });
    expect(result.name).toBe("read_file");
    expect(result.title).toContain("tool-result-test.txt");
    expect(result.input).toBe(tmpPath);
    expect(result.output).toContain("hello world");
    expect(result.is_error).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("read_file for missing file returns error ToolResult", async () => {
    const result = await executeTool("read_file", { path: "/tmp/definitely-does-not-exist-xyz.ts" });
    expect(result.is_error).toBe(true);
    expect(result.title).toContain("not found");
    expect(result.output).toContain("File not found");
  });

  test("write_file returns ToolResult", async () => {
    const tmpPath = "/tmp/tool-result-write-test.txt";
    const result = await executeTool("write_file", { path: tmpPath, content: "test content" });
    expect(result.name).toBe("write_file");
    expect(result.title).toContain("tool-result-write-test.txt");
    expect(result.is_error).toBe(false);
    expect(result.output).toContain("12 bytes");
  });

  test("bash returns ToolResult with exitCode", async () => {
    const result = await executeTool("bash", { command: "echo structuredOutput" });
    expect(result.name).toBe("bash");
    expect(result.exitCode).toBe(0);
    expect(result.is_error).toBe(false);
    expect(result.output).toContain("structuredOutput");
    expect(result.title).toBe("echo structuredOutput");
  });

  test("bash failure includes exitCode", async () => {
    const result = await executeTool("bash", { command: "exit 42" });
    expect(result.is_error).toBe(true);
    expect(result.exitCode).toBe(42);
    expect(result.output).toContain("Exit code 42");
  });

  test("glob returns ToolResult with match count in title", async () => {
    const result = await executeTool("glob", { pattern: "*.ts", path: "/tmp" });
    expect(result.name).toBe("glob");
    expect(result.title).toContain("matches");
    expect(result.is_error).toBe(false);
  });

  test("list_dir returns ToolResult with entry count in title", async () => {
    const result = await executeTool("list_dir", { path: "/tmp" });
    expect(result.name).toBe("list_dir");
    expect(result.title).toContain("entries");
    expect(result.is_error).toBe(false);
  });

  test("unknown tool returns error ToolResult", async () => {
    const result = await executeTool("nonexistent_tool", { foo: "bar" });
    expect(result.is_error).toBe(true);
    expect(result.output).toContain("Unknown tool");
  });

  test("durationMs is positive for real operations", async () => {
    const result = await executeTool("bash", { command: "sleep 0.01" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
