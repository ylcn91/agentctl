
export type Mode = "input" | "browse";
export type Overlay = "none" | "accounts" | "sessions" | "slash" | "models" | "files" | "council" | "retro";

export const MAX_VISIBLE_MESSAGES = 20;
export const MAX_STREAMING_CHUNKS = 150;
export const SIDEBAR_WIDTH = 42;
export const MAX_MESSAGE_CONTENT_BYTES = 120_000;
export const MAX_MESSAGE_LINES = 800;
export function computeDockHeight(opts: {
  inputLines: number;
  slashVisible: boolean;
  slashCount: number;
  fileVisible: boolean;
  fileCount: number;
}): number {
  const inputH = Math.max(3, opts.inputLines + 2);
  const footerH = 1;
  let h = inputH + footerH + 1;

  if (opts.slashVisible) {
    h += Math.min(8, Math.max(1, opts.slashCount)) + 2;
  }
  if (opts.fileVisible) {
    h += Math.min(8, Math.max(1, opts.fileCount)) + 1 + 2;
  }
  return h;
}

export const LOGO = [
  " \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2557",
  "\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2551",
  "\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u255A\u2588\u2588\u2551",
  " \u255A\u2550\u2550\u2550\u2588\u2588\u2551  \u2588\u2588\u2551",
  " \u2588\u2588\u2588\u2588\u2588\u2588\u2551  \u2588\u2588\u2551",
  " \u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u255D",
].join("\n");

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
}

export interface ModelOption {
  id: string;
  label: string;
  short: string;
}

export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  "claude-code": [
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", short: "haiku" },
    { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5", short: "sonnet" },
    { id: "claude-opus-4-6", label: "Opus 4.6", short: "opus" },
  ],
  "codex-cli": [
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", short: "5.3-codex" },
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", short: "5.2-codex" },
    { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", short: "5.1-max" },
    { id: "gpt-5.2", label: "GPT-5.2", short: "5.2" },
    { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", short: "5.1-mini" },
  ],
  "openhands": [
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", short: "sonnet" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner", short: "ds-reason" },
    { id: "deepseek-chat", label: "DeepSeek Chat", short: "ds-chat" },
  ],
  "gemini-cli": [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", short: "2.5-pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", short: "2.5-flash" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", short: "2.0-flash" },
  ],
  "opencode": [
    { id: "opencode/minimax-m2.5-free", label: "MiniMax M2.5 Free", short: "m2.5-free" },
    { id: "opencode/minimax-m2.5", label: "MiniMax M2.5", short: "m2.5" },
    { id: "opencode/kimi-k2.5-free", label: "Kimi K2.5 Free", short: "k2.5-free" },
    { id: "opencode/kimi-k2.5", label: "Kimi K2.5", short: "k2.5" },
    { id: "opencode/kimi-k2-thinking", label: "Kimi K2 Thinking", short: "k2-think" },
    { id: "opencode/kimi-k2", label: "Kimi K2", short: "k2" },
    { id: "opencode/gpt-5.2-codex", label: "GPT 5.2 Codex", short: "5.2-codex" },
    { id: "opencode/gpt-5.2", label: "GPT 5.2", short: "gpt-5.2" },
    { id: "opencode/gpt-5.1-codex-max", label: "GPT 5.1 Codex Max", short: "5.1-max" },
    { id: "opencode/claude-opus-4-6", label: "Claude Opus 4.6", short: "opus-4.6" },
    { id: "opencode/claude-sonnet-4-5", label: "Claude Sonnet 4.5", short: "sonnet-4.5" },
    { id: "opencode/gemini-3-pro", label: "Gemini 3 Pro", short: "gem-3-pro" },
    { id: "opencode/gemini-3-flash", label: "Gemini 3 Flash", short: "gem-3-flash" },
    { id: "opencode/glm-5", label: "GLM 5", short: "glm-5" },
    { id: "opencode/qwen3-coder", label: "Qwen3 Coder 480B", short: "qwen3" },
    { id: "opencode/big-pickle", label: "Big Pickle (Free)", short: "bp" },
  ],
  "cursor-agent": [
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", short: "sonnet" },
    { id: "gpt-5.2", label: "GPT-5.2", short: "gpt-5.2" },
    { id: "cursor-small", label: "Cursor Small", short: "small" },
  ],
};

export const CLAUDE_MODELS = PROVIDER_MODELS["claude-code"]!;

export function getModelsForProvider(provider: string): ModelOption[] {
  return PROVIDER_MODELS[provider] ?? PROVIDER_MODELS["claude-code"]!;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "accounts", label: "/accounts", description: "Switch account" },
  { id: "sessions", label: "/sessions", description: "Switch session" },
  { id: "new", label: "/new", description: "New session" },
  { id: "model", label: "/model", description: "Choose model for current account" },
  { id: "delegate", label: "/delegate", description: "Delegate task to another agent" },
  { id: "council", label: "/council", description: "Council discussion: /council <topic>" },
  { id: "tasks", label: "/tasks", description: "Show task board" },
  { id: "inbox", label: "/inbox", description: "Show message inbox" },
  { id: "health", label: "/health", description: "Show health dashboard" },
  { id: "analytics", label: "/analytics", description: "Show analytics summary" },
  { id: "workflow", label: "/workflow", description: "Show workflow list" },
  { id: "sla", label: "/sla", description: "Show SLA status" },
  { id: "msg", label: "/msg", description: "Send message: /msg <account> <text>" },
  { id: "handoff", label: "/handoff", description: "Hand off task: /handoff <account> <task>" },
  { id: "copy", label: "/copy", description: "Copy last response to clipboard" },
  { id: "export", label: "/export", description: "Export transcript to clipboard" },
  { id: "retro", label: "/retro", description: "Start retro inline: /retro [topic]" },
  { id: "plan", label: "/plan", description: "Toggle planning mode" },
  { id: "clear", label: "/clear", description: "Clear conversation" },
  { id: "dashboard", label: "/dashboard", description: "Back to dashboard" },
  { id: "help", label: "/help", description: "Show keybindings" },
];

export function modelShortLabel(modelId: string): string {
  for (const models of Object.values(PROVIDER_MODELS)) {
    const match = models.find((m) => m.id === modelId);
    if (match) return match.short;
  }
  if (modelId.includes("opus")) return "opus";
  if (modelId.includes("haiku")) return "haiku";
  if (modelId.includes("sonnet")) return "sonnet";
  if (modelId.includes("gemini")) return modelId.replace("gemini-", "");
  if (modelId.startsWith("gpt-")) return modelId.slice(4);
  if (modelId.startsWith("MiniMax-")) return modelId.slice(8).toLowerCase();
  if (modelId.startsWith("kimi-")) return modelId.slice(5);
  if (modelId.startsWith("deepseek-")) return "ds-" + modelId.slice(9);
  return modelId.split("-").slice(0, 2).join("-");
}

export function parseToolInput(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    if (obj.file_path) return obj.file_path;
    if (obj.command) return obj.command.slice(0, 80);
    if (obj.pattern) return obj.pattern;
    if (obj.query) return obj.query;
    const vals = Object.values(obj).filter((v) => typeof v === "string") as string[];
    return vals[0]?.slice(0, 80) ?? "";
  } catch {
    return raw.slice(0, 80);
  }
}

export function truncateContent(content: string): string {
  let text = content;
  let wasTruncated = false;

  if (text.length > MAX_MESSAGE_CONTENT_BYTES) {
    text = text.slice(0, MAX_MESSAGE_CONTENT_BYTES);
    wasTruncated = true;
  }

  const lines = text.split("\n");
  if (lines.length > MAX_MESSAGE_LINES) {
    text = lines.slice(0, MAX_MESSAGE_LINES).join("\n");
    wasTruncated = true;
  }

  if (wasTruncated) {
    const totalLines = content.split("\n").length;
    const totalKB = Math.ceil(content.length / 1024);
    return text + `\n\n... (truncated — ${totalLines} lines, ${totalKB}KB total)`;
  }
  return content;
}
