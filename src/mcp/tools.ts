import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateHandoff } from "../services/handoff.js";

export type DaemonSender = (msg: object) => Promise<any>;

export function registerTools(server: McpServer, sendToDaemon: DaemonSender, account: string): void {
  server.registerTool("send_message", {
    description: "Send a message to another Claude Code account",
    inputSchema: {
      to: z.string().describe("Target account name"),
      message: z.string().describe("Message content"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "send_message",
      to: args.to,
      content: args.message,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("read_messages", {
    description: "Read unread messages from other accounts",
    inputSchema: {
      limit: z.number().optional().describe("Max messages to return (default 50)"),
      offset: z.number().optional().describe("Offset for pagination"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "read_messages", limit: args.limit, offset: args.offset });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.messages ?? []) }] };
  });

  server.registerTool("list_accounts", {
    description: "List all registered accounts and their status",
  }, async () => {
    const result = await sendToDaemon({ type: "list_accounts" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result.accounts ?? []) }] };
  });

  server.registerTool("copy_context", {
    description: "Copy context/content to the shared clipboard for other accounts to access",
    inputSchema: {
      content: z.string().describe("Content to copy"),
      label: z.string().optional().describe("Optional label for the clipboard entry"),
    },
  }, async (args) => {
    const { copyToClipboard } = await import("../services/clipboard.js");
    const entry = await copyToClipboard(account, args.content, args.label);
    return { content: [{ type: "text" as const, text: JSON.stringify({ copied: true, id: entry.id }) }] };
  });

  server.registerTool("paste_context", {
    description: "Get the most recent content from the shared clipboard",
    inputSchema: {
      count: z.number().optional().describe("Number of entries to retrieve (default 1)"),
    },
  }, async (args) => {
    const { pasteFromClipboard } = await import("../services/clipboard.js");
    const entries = await pasteFromClipboard(args.count);
    return { content: [{ type: "text" as const, text: JSON.stringify(entries) }] };
  });

  server.registerTool("handoff_task", {
    description: "Hand off a task to another Claude Code account with a structured contract (goal, acceptance criteria, run commands, blockers). The task is persisted and delivered when the target account connects.",
    inputSchema: {
      to: z.string().describe("Target account name"),
      goal: z.string().describe("What the task should accomplish"),
      acceptance_criteria: z.array(z.string()).min(1).describe("List of acceptance criteria"),
      run_commands: z.array(z.string()).min(1).describe("Commands to run/verify the work"),
      blocked_by: z.array(z.string()).min(1).describe('Task IDs this is blocked by, or ["none"]'),
      branch: z.string().optional().describe("Git branch for context"),
      projectDir: z.string().optional().describe("Project directory path"),
      notes: z.string().optional().describe("Additional notes or context"),
    },
  }, async (args) => {
    const validation = validateHandoff({
      goal: args.goal,
      acceptance_criteria: args.acceptance_criteria,
      run_commands: args.run_commands,
      blocked_by: args.blocked_by,
    });
    if (!validation.valid) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid handoff payload", details: validation.errors }) }] };
    }

    const context: Record<string, string> = {};
    if (args.branch) context.branch = args.branch;
    if (args.projectDir) context.projectDir = args.projectDir;
    if (args.notes) context.notes = args.notes;

    const result = await sendToDaemon({
      type: "handoff_task",
      to: args.to,
      payload: validation.payload,
      context,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("update_task_status", {
    description: "Update a task's status following lifecycle rules (todo→in_progress→ready_for_review→accepted/rejected)",
    inputSchema: {
      taskId: z.string().describe("Task ID"),
      status: z.enum(["todo", "in_progress", "ready_for_review", "accepted", "rejected"]).describe("New status"),
      reason: z.string().optional().describe("Required reason when rejecting"),
    },
  }, async (args) => {
    const result = await sendToDaemon({
      type: "update_task_status",
      taskId: args.taskId,
      status: args.status,
      reason: args.reason,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });

  server.registerTool("archive_messages", {
    description: "Archive old read messages (older than specified days)",
    inputSchema: {
      days: z.number().optional().describe("Days old to archive (default 7)"),
    },
  }, async (args) => {
    const result = await sendToDaemon({ type: "archive_messages", days: args.days });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  });
}
