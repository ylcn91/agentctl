
import { createSignal, batch, type Accessor, type Setter } from "solid-js";
import { loadTasks } from "../../../services/tasks.js";
import { delegateToAgent } from "../../../services/agent-orchestration.js";
import { copyToClipboard } from "../../util/clipboard.js";
import type { ChatMessage } from "../../../services/chat-session.js";
import type { AccountConfig } from "../../../types.js";
import type { Overlay } from "./helpers.js";
import { SLASH_COMMANDS } from "./helpers.js";
import type { Route } from "../../context/route.js";
import type { SessionManager } from "./use-session.js";
import type { CouncilController } from "./use-council-state.js";

export interface SlashCommandHandler {
  planningMode: Accessor<boolean>;
  delegating: Accessor<boolean>;
  executeSlash: (cmd: (typeof SLASH_COMMANDS)[number]) => void;
  handleTextCommand: (text: string) => boolean;
  copyLastResponse: () => Promise<void>;
}

export function createSlashCommands(deps: {
  session: SessionManager;
  accounts: Accessor<AccountConfig[]>;
  daemonConnected: Accessor<boolean>;
  council: CouncilController;
  send: (text: string) => Promise<void>;
  setInputBuffer: Setter<string>;
  setCursorPos: Setter<number>;
  setOverlay: Setter<Overlay>;
  setSlashSelected: Setter<number>;
  newSession: () => void;
  clear: () => void;
  routeNavigate: (route: Route) => void;
  setShellMode: Setter<boolean>;
  toggleHelp: () => void;
}): SlashCommandHandler {
  const [planningMode, setPlanningMode] = createSignal(false);
  const [delegating, setDelegating] = createSignal(false);

  function addSystemMessage(content: string) {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
    };
    deps.session.setMessages((prev) => [...prev, msg]);
  }

  async function showTaskSummary() {
    try {
      const board = await loadTasks();
      const tasks = board.tasks;
      if (tasks.length === 0) { addSystemMessage("[tasks] No tasks found."); return; }
      const byStatus = tasks.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {} as Record<string, number>);
      const lines = [`[tasks] ${tasks.length} total`];
      for (const [status, count] of Object.entries(byStatus)) {
        lines.push(`  ${status}: ${count}`);
      }
      const active = tasks.filter((t) => t.status === "in_progress").slice(0, 3);
      if (active.length > 0) {
        lines.push("");
        lines.push("Active:");
        for (const t of active) lines.push(`  - ${t.title} (${t.assignee ?? "unassigned"})`);
      }
      addSystemMessage(lines.join("\n"));
    } catch { addSystemMessage("[tasks] Failed to load tasks."); }
  }

  function showInboxSummary() {
    if (!deps.daemonConnected()) { addSystemMessage("[inbox] Daemon not connected. Start with: actl daemon start"); return; }
    addSystemMessage("[inbox] Daemon connected. Use /msg <account> <text> to send messages, or press 'm' in browse mode to open inbox.");
  }

  function showHealthSummary() {
    const connected = deps.daemonConnected();
    const lines = ["[health]", `  Daemon: ${connected ? "connected" : "disconnected"}`];
    const accs = deps.accounts();
    if (accs.length > 0) lines.push(`  Accounts: ${accs.length} configured`);
    addSystemMessage(lines.join("\n"));
  }

  function showSlaSummary() {
    addSystemMessage("[sla] SLA status: use 'actl health' or press 'e' in browse mode for the full SLA board.");
  }

  function showWorkflowSummary() {
    addSystemMessage("[workflow] Use 'w' in browse mode to open the workflow board, or run 'actl workflow status' in the CLI.");
  }

  function togglePlanningMode() {
    setPlanningMode(p => !p);
  }

  async function copyLastResponse() {
    const msgs = deps.session.messages();
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) {
      addSystemMessage("[copy] No assistant response to copy.");
      return;
    }
    try {
      await copyToClipboard(lastAssistant.content);
      addSystemMessage("[copy] Last response copied to clipboard.");
    } catch {
      addSystemMessage("[copy] Failed to copy to clipboard.");
    }
  }

  async function exportTranscript() {
    const msgs = deps.session.messages();
    if (msgs.length === 0) {
      addSystemMessage("[export] No messages to export.");
      return;
    }
    const accountName = deps.session.account()?.label || deps.session.account()?.name || "Chat";
    const lines = msgs.map((m) => {
      const role = m.role === "user" ? "**You**" : `**${accountName}**`;
      return `${role}\n\n${m.content}\n`;
    });
    const transcript = lines.join("\n---\n\n");
    try {
      await copyToClipboard(transcript);
      addSystemMessage(`[export] Transcript (${msgs.length} messages) copied to clipboard.`);
    } catch {
      addSystemMessage("[export] Failed to export to clipboard.");
    }
  }

  function handleDelegation(targetAccount: AccountConfig, instruction: string) {
    deps.send(`/delegate ${targetAccount.name} ${instruction}`);
    setDelegating(true);
    const abortController = new AbortController();
    delegateToAgent({
      fromAccount: deps.session.account()?.name ?? "unknown",
      toAccount: targetAccount,
      instruction,
      onChunk: () => {},
      signal: abortController.signal,
    })
      .then((result) => {
        deps.send(`[delegation from ${targetAccount.name}] ${result.content.slice(0, 8000)}`);
      })
      .catch((err: any) => {
        deps.send(`[delegation error] ${err.message}`);
      })
      .finally(() => {
        setDelegating(false);
      });
  }

  function executeSlash(cmd: (typeof SLASH_COMMANDS)[number]) {
    batch(() => {
      deps.setInputBuffer("");
      deps.setCursorPos(0);
      deps.setOverlay("none");
      deps.setSlashSelected(0);
      deps.setShellMode(false);
    });
    switch (cmd.id) {
      case "accounts": deps.setOverlay("accounts"); break;
      case "sessions": deps.setOverlay("sessions"); break;
      case "new": deps.newSession(); break;
      case "model": deps.setOverlay("models"); break;
      case "delegate": deps.setInputBuffer("/delegate "); deps.setCursorPos(10); deps.setOverlay("none"); return;
      case "council": deps.setOverlay("council"); break;
      case "tasks": showTaskSummary(); break;
      case "inbox": showInboxSummary(); break;
      case "health": showHealthSummary(); break;
      case "analytics": deps.routeNavigate({ type: "analytics" }); break;
      case "workflow": showWorkflowSummary(); break;
      case "sla": showSlaSummary(); break;
      case "msg": deps.setInputBuffer("/msg "); deps.setCursorPos(5); deps.setOverlay("none"); return;
      case "handoff": deps.setInputBuffer("/handoff "); deps.setCursorPos(9); deps.setOverlay("none"); return;
      case "copy": copyLastResponse(); break;
      case "export": exportTranscript(); break;
      case "retro": deps.setOverlay("retro"); break;
      case "plan": togglePlanningMode(); break;
      case "clear": deps.clear(); break;
      case "dashboard": deps.routeNavigate({ type: "dashboard" }); break;
      case "help": deps.toggleHelp(); break;
    }
  }

  function handleTextCommand(text: string): boolean {

    if (text.startsWith("/msg ")) {
      const parts = text.slice(5).trim().split(/\s+/);
      const [targetName, ...rest] = parts;
      const msgText = rest.join(" ");
      if (targetName && msgText) {
        deps.send(`[sending message to ${targetName}] ${msgText}`);
      }
      return true;
    }

    if (text.startsWith("/handoff ")) {
      const parts = text.slice(9).trim().split(/\s+/);
      const [targetName, ...rest] = parts;
      const taskDesc = rest.join(" ");
      if (targetName && taskDesc) {
        const target = deps.accounts().find((a) => a.name === targetName);
        if (target) {
          handleDelegation(target, taskDesc);
        } else {
          deps.send(`[handoff error] Account not found: ${targetName}`);
        }
      }
      return true;
    }

    if (text.startsWith("/delegate ")) {
      const parts = text.slice(10).trim().split(/\s+/);
      const [targetName, ...rest] = parts;
      const instruction = rest.join(" ");
      if (!targetName || !instruction) return true;
      const target = deps.accounts().find((a) => a.name === targetName);
      if (!target) { deps.send(`[delegation error] Account not found: ${targetName}`); return true; }
      handleDelegation(target, instruction);
      return true;
    }

    if (text.startsWith("/council ")) {
      const topic = text.slice(9).trim();
      if (topic) {
        deps.council.startCouncilInChat(topic);
      } else {
        addSystemMessage("[council] Usage: /council <topic>");
      }
      return true;
    }

    if (text.startsWith("/retro")) {
      const topic = text.slice(6).trim();
      deps.council.startRetroInChat(topic);
      return true;
    }

    return false;
  }

  return { planningMode, delegating, executeSlash, handleTextCommand, copyLastResponse };
}
