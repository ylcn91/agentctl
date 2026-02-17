
import type { AuthCredentials } from "./auth-store";
import type { NormalizedChunk } from "./stream-normalizer";
import { streamText, stepCountIs } from "ai";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { createProvider, ensureFreshCreds } from "./ai-provider.js";
import { AI_SDK_TOOLS } from "./anthropic-tools.js";
import { cleanupSpillFiles } from "./truncation.js";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 16384;
const MAX_TOOL_ROUNDS = 25;
const THINKING_BUDGET_TOKENS = 10000;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, any> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface StreamOptions {
  accountName: string;
  creds: AuthCredentials;
  messages: AnthropicMessage[];
  system?: string;
  model?: string;
  onChunk: (chunk: NormalizedChunk) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function streamAnthropicResponse(opts: StreamOptions): Promise<{
  content: string;
  tokenCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  updatedMessages: AnthropicMessage[];
}> {
  const startTime = Date.now();
  const creds = await ensureFreshCreds(opts.creds, opts.accountName);
  const provider = createProvider(creds);

  cleanupSpillFiles().catch(() => {});

  const cwd = process.cwd();
  const modelId = opts.model ?? DEFAULT_MODEL;
  const systemPrompt = opts.system ?? [
    `You are Claude, an AI assistant powered by the model ${modelId}.`,
    `The exact model ID is ${modelId}.`,
    `Current working directory: ${cwd}`,
    `You can read files, write files, run bash commands, search with glob/grep, and list directories.`,
    `Use tools proactively to explore the codebase and make changes when asked.`,
  ].join("\n");

  const messages = opts.messages.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
  }));

  const result = streamText({
    model: provider(opts.model ?? DEFAULT_MODEL),
    system: systemPrompt,
    messages,
    tools: AI_SDK_TOOLS,
    stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
    maxOutputTokens: MAX_TOKENS,
    abortSignal: opts.signal,
    providerOptions: {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: THINKING_BUDGET_TOKENS },
      } satisfies AnthropicProviderOptions,
    },
  });

  const allText: string[] = [];
  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let stepCount = 0;

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        allText.push(part.text);
        await opts.onChunk({ chunkType: "text", content: part.text });
        break;

      case "reasoning-delta":
        await opts.onChunk({ chunkType: "thinking", content: part.text });
        break;

      case "tool-call":
        await opts.onChunk({
          chunkType: "tool_use",
          content: part.toolName,
          toolName: part.toolName,
          toolInput: JSON.stringify(part.input),
        });
        console.error(`[anthropic]   tool: ${part.toolName}`);
        break;

      case "tool-result": {
        const output = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
        const summary = output.length > 200 ? output.slice(0, 200) + "..." : output;
        await opts.onChunk({ chunkType: "tool_result", content: summary });
        break;
      }

      case "finish-step":
        stepCount++;
        if (stepCount > 1) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          await opts.onChunk({ chunkType: "text", content: `\n\n--- round ${stepCount} (${elapsed}s) ---\n` });
          console.error(`[anthropic] round ${stepCount}/${MAX_TOOL_ROUNDS} (${elapsed}s elapsed)`);
        }
        break;

      case "finish":
        if (part.totalUsage) {
          totalTokens = part.totalUsage.totalTokens ?? 0;
          totalInputTokens = part.totalUsage.inputTokens ?? 0;
          totalOutputTokens = part.totalUsage.outputTokens ?? 0;
        }
        break;

      case "error":
        await opts.onChunk({ chunkType: "error", content: String(part.error) });
        break;
    }
  }

  const content = allText.join("");
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`[anthropic] done after ${stepCount} step(s), ${totalTokens} tokens, ${elapsed}s`);

  return {
    content: content || "(no response)",
    tokenCount: totalTokens || undefined,
    inputTokens: totalInputTokens || undefined,
    outputTokens: totalOutputTokens || undefined,
    durationMs: Date.now() - startTime,
    updatedMessages: [...opts.messages, { role: "assistant" as const, content }],
  };
}

export async function streamSimpleResponse(opts: {
  accountName: string;
  creds: AuthCredentials;
  system: string;
  userPrompt: string;
  model?: string;
  onChunk: (chunk: NormalizedChunk) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<{ content: string; tokenCount?: number; durationMs: number }> {
  const startTime = Date.now();
  const creds = await ensureFreshCreds(opts.creds, opts.accountName);
  const provider = createProvider(creds);

  const result = streamText({
    model: provider(opts.model ?? DEFAULT_MODEL),
    system: opts.system,
    messages: [{ role: "user" as const, content: opts.userPrompt }],
    maxOutputTokens: MAX_TOKENS,
    abortSignal: opts.signal,
  });

  const textParts: string[] = [];
  let tokenCount: number | undefined;

  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      textParts.push(part.text);
      await opts.onChunk({ chunkType: "text", content: part.text });
    } else if (part.type === "finish" && part.totalUsage) {
      tokenCount = part.totalUsage.totalTokens ?? undefined;
    }
  }

  return {
    content: textParts.join(""),
    tokenCount: tokenCount || undefined,
    durationMs: Date.now() - startTime,
  };
}
