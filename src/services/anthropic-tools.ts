
import { truncateOutput } from "./truncation.js";
import { readdir } from "node:fs/promises";
import { resolve } from "path";
import { tool } from "ai";
import { z } from "zod";

export interface ToolResult {
  name: string;
  title: string;
  input: string;
  output: string;
  exitCode?: number;
  durationMs: number;
  truncated: boolean;
  is_error: boolean;
}

export function formatToolSummary(r: ToolResult): string {
  const status = r.is_error ? "ERR" : "ok";
  const size = r.output.length > 1024
    ? `${(r.output.length / 1024).toFixed(1)}KB`
    : `${r.output.length}B`;
  const trunc = r.truncated ? " [truncated]" : "";
  return `${r.name}: ${r.title} (${size}${trunc}) [${status}]`;
}

export const TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file at the given path. Use this to examine existing files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "The absolute or relative file path to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "The file path to write to" },
        content: { type: "string" as const, description: "The content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "bash",
    description: "Execute a bash command and return its output. Use for git, npm, running tests, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string" as const, description: "The bash command to execute" },
      },
      required: ["command"],
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern. Returns a list of matching file paths.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string" as const, description: "Glob pattern (e.g. '***.tsx')" },
        path: { type: "string" as const, description: "Directory to search in (defaults to cwd)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description: "Search file contents for a regex pattern. Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string" as const, description: "Regex pattern to search for" },
        path: { type: "string" as const, description: "File or directory to search in (defaults to cwd)" },
        glob: { type: "string" as const, description: "Glob filter for files (e.g. '*.ts')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_dir",
    description: "List files and directories in the given path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Directory path to list (defaults to cwd)" },
      },
      required: [],
    },
  },
];

export async function executeTool(name: string, input: Record<string, any>): Promise<ToolResult> {
  const start = Date.now();
  const inputStr = compactInput(name, input);

  try {
    switch (name) {
      case "read_file": {
        const p = resolve(input.path);
        const file = Bun.file(p);
        if (!(await file.exists())) return toolResult(name, `${p} (not found)`, inputStr, `Error: File not found: ${p}`, true, false, start);
        const text = await file.text();
        const lines = text.split("\n").map((line, i) => `${i + 1}\t${line}`).join("\n");
        const truncated = await truncateOutput(lines);
        return toolResult(name, p, inputStr, truncated.content, false, truncated.truncated, start);
      }

      case "write_file": {
        const p = resolve(input.path);
        const dir = p.substring(0, p.lastIndexOf("/"));
        await Bun.spawn(["mkdir", "-p", dir]).exited;
        await Bun.write(p, input.content);
        const msg = `Written ${input.content.length} bytes to ${p}`;
        return toolResult(name, p, inputStr, msg, false, false, start);
      }

      case "bash": {
        const proc = Bun.spawn(["bash", "-c", input.command], {
          stdout: "pipe", stderr: "pipe", env: process.env, timeout: 30_000,
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : "");
        const result = exitCode === 0 ? output || "(no output)" : `Exit code ${exitCode}\n${output}`;
        const truncated = await truncateOutput(result);
        return { ...toolResult(name, input.command.slice(0, 60), inputStr, truncated.content, exitCode !== 0, truncated.truncated, start), exitCode };
      }

      case "glob": {
        const dir = input.path ? resolve(input.path) : process.cwd();
        const glob = new Bun.Glob(input.pattern);
        const matches: string[] = [];
        for await (const match of glob.scan({ cwd: dir, absolute: true })) {
          matches.push(match);
          if (matches.length >= 100) break;
        }
        const content = matches.length > 0 ? matches.join("\n") : "No matches found";
        return toolResult(name, `${input.pattern} (${matches.length} matches)`, inputStr, content, false, false, start);
      }

      case "grep": {
        const dir = input.path ? resolve(input.path) : process.cwd();
        const args = ["rg", "--line-number", "--no-heading", "--max-count", "50"];
        if (input.glob) args.push("--glob", input.glob);
        args.push(input.pattern, dir);
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
        const stdout = await new Response(proc.stdout).text();
        await proc.exited;
        if (!stdout) return toolResult(name, `${input.pattern} (0 matches)`, inputStr, "No matches found", false, false, start);
        const truncated = await truncateOutput(stdout);
        const lineCount = stdout.split("\n").filter(Boolean).length;
        return toolResult(name, `${input.pattern} (${lineCount} matches)`, inputStr, truncated.content, false, truncated.truncated, start);
      }

      case "list_dir": {
        const dir = input.path ? resolve(input.path) : process.cwd();
        const entries = await readdir(dir, { withFileTypes: true });
        const lines = entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`);
        const content = lines.join("\n") || "(empty directory)";
        return toolResult(name, `${dir} (${entries.length} entries)`, inputStr, content, false, false, start);
      }

      default:
        return toolResult(name, name, inputStr, `Unknown tool: ${name}`, true, false, start);
    }
  } catch (err: any) {
    return toolResult(name, name, inputStr, `Error: ${err.message}`, true, false, start);
  }
}

export const AI_SDK_TOOLS = {
  read_file: tool({
    description: "Read the contents of a file at the given path. Use this to examine existing files.",
    inputSchema: z.object({
      path: z.string().describe("The absolute or relative file path to read"),
    }),
    execute: async ({ path }) => {
      const result = await executeTool("read_file", { path });
      return result.output;
    },
  }),
  write_file: tool({
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    inputSchema: z.object({
      path: z.string().describe("The file path to write to"),
      content: z.string().describe("The content to write"),
    }),
    execute: async ({ path, content }) => {
      const result = await executeTool("write_file", { path, content });
      return result.output;
    },
  }),
  bash: tool({
    description: "Execute a bash command and return its output. Use for git, npm, running tests, etc.",
    inputSchema: z.object({
      command: z.string().describe("The bash command to execute"),
    }),
    execute: async ({ command }) => {
      const result = await executeTool("bash", { command });
      return result.output;
    },
  }),
  glob: tool({
    description: "Find files matching a glob pattern. Returns a list of matching file paths.",
    inputSchema: z.object({
      pattern: z.string().describe("Glob pattern (e.g. '***.tsx')"),
      path: z.string().optional().describe("Directory to search in (defaults to cwd)"),
    }),
    execute: async ({ pattern, path }) => {
      const result = await executeTool("glob", { pattern, ...(path ? { path } : {}) });
      return result.output;
    },
  }),
  grep: tool({
    description: "Search file contents for a regex pattern. Returns matching lines with file paths and line numbers.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      path: z.string().optional().describe("File or directory to search in (defaults to cwd)"),
      glob: z.string().optional().describe("Glob filter for files (e.g. '*.ts')"),
    }),
    execute: async ({ pattern, path, glob }) => {
      const input: Record<string, string> = { pattern };
      if (path) input.path = path;
      if (glob) input.glob = glob;
      const result = await executeTool("grep", input);
      return result.output;
    },
  }),
  list_dir: tool({
    description: "List files and directories in the given path.",
    inputSchema: z.object({
      path: z.string().optional().describe("Directory path to list (defaults to cwd)"),
    }),
    execute: async ({ path }) => {
      const result = await executeTool("list_dir", { ...(path ? { path } : {}) });
      return result.output;
    },
  }),
};

function toolResult(name: string, title: string, input: string, output: string, is_error: boolean, truncated: boolean, start: number): ToolResult {
  return { name, title, input, output, durationMs: Date.now() - start, truncated, is_error };
}

function compactInput(name: string, input: Record<string, any>): string {
  switch (name) {
    case "read_file": return input.path ?? "";
    case "write_file": return input.path ?? "";
    case "bash": return (input.command ?? "").slice(0, 100);
    case "glob": return input.pattern ?? "";
    case "grep": return input.pattern ?? "";
    case "list_dir": return input.path ?? process.cwd();
    default: return JSON.stringify(input).slice(0, 100);
  }
}
