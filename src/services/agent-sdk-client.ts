
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { NormalizedChunk } from "./stream-normalizer";

export interface AgentSDKOptions {
  prompt: string;
  sessionId?: string;
  forkSession?: boolean;
  maxTurns?: number;
  model?: string;
  outputSchema?: Record<string, unknown>;
  allowedTools?: string[];
  signal?: AbortSignal;
  onChunk: (chunk: NormalizedChunk) => void;
}

export interface AgentSDKResult {
  content: string;
  sessionId?: string;
  cost?: number;
  tokenCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  model?: string;
  stopReason?: string;
}

function buildCleanEnv(): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    if (k.startsWith("CLAUDECODE")) continue;
    if (k === "CLAUDE_SESSION_ID") continue;
    if (k === "CLAUDE_CONTEXT_ID") continue;
    if (k === "CLAUDE_CONVERSATION_ID") continue;
    clean[k] = v;
  }
  return clean;
}

function totalInputFromUsage(usage: Record<string, any>): number | undefined {
  const direct = usage.input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const total = direct + cacheCreate + cacheRead;
  return total > 0 ? total : undefined;
}

export async function streamViaAgentSDK(opts: AgentSDKOptions): Promise<AgentSDKResult> {
  const startTime = Date.now();
  const accumulatedText: string[] = [];
  let sessionId: string | undefined;
  let cost: number | undefined;
  let tokenCount: number | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let model: string | undefined;
  let stopReason: string | undefined;

  let currentToolName: string | null = null;
  let currentToolInput = "";
  let receivedStreamEvents = false;

  const debug = process.env.ACTL_DEBUG
    ? (label: string, data: any) => process.stderr.write(`[actl-sdk] ${label}: ${JSON.stringify(data)}\n`)
    : (_l: string, _d: any) => {};

  const queryOpts: Parameters<typeof query>[0] = {
    prompt: opts.prompt,
    options: {
      maxTurns: opts.maxTurns ?? 10,
      env: buildCleanEnv(),
      permissionMode: "bypassPermissions",

      includePartialMessages: true,

      thinking: { type: "adaptive" },

      model: opts.model,
    },
  };

  if (opts.sessionId) {
    (queryOpts.options as any).resume = opts.sessionId;
    if (opts.forkSession) {
      (queryOpts.options as any).forkSession = true;
    }
  }

  if (opts.allowedTools !== undefined) {
    queryOpts.options!.allowedTools = opts.allowedTools;
  }

  queryOpts.options!.stderr = (data: string) => {
    if (data.includes("Error") || data.includes("error")) {
      opts.onChunk({ chunkType: "error", content: data.trim() });
    }
  };

  for await (const message of query(queryOpts)) {
    if (opts.signal?.aborted) break;

    const msg = message as Record<string, any>;
    debug("msg_type", { type: msg.type, subtype: msg.subtype });

    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      model = msg.model;
      opts.onChunk({ chunkType: "system", content: "session_start" });
      continue;
    }

    if (msg.type === "stream_event") {
      receivedStreamEvents = true;
      const event = msg.event;
      if (!event) continue;

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block?.type === "tool_use") {
          currentToolName = block.name ?? "tool";
          currentToolInput = "";
          opts.onChunk({
            chunkType: "tool_use",
            content: currentToolName!,
            toolName: currentToolName!,
          });
        }
        continue;
      }

      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (!delta) continue;

        if (delta.type === "text_delta" && delta.text) {
          accumulatedText.push(delta.text);
          opts.onChunk({ chunkType: "text", content: delta.text });
        } else if (delta.type === "thinking_delta" && delta.thinking) {
          opts.onChunk({ chunkType: "thinking", content: delta.thinking });
        } else if (delta.type === "input_json_delta" && delta.partial_json) {
          currentToolInput += delta.partial_json;
        }
        continue;
      }

      if (event.type === "content_block_stop") {
        if (currentToolName) {

          opts.onChunk({
            chunkType: "tool_use",
            content: currentToolName,
            toolName: currentToolName,
            toolInput: currentToolInput || undefined,
          });
          currentToolName = null;
          currentToolInput = "";
        }
        continue;
      }

      if (event.type === "message_delta") {
        if (event.usage) {
          debug("message_delta.usage", event.usage);
          const totalIn = totalInputFromUsage(event.usage);
          if (totalIn != null) {
            inputTokens = Math.max(inputTokens ?? 0, totalIn);
          }
          outputTokens = event.usage.output_tokens ?? outputTokens;
          tokenCount = (inputTokens ?? 0) + (outputTokens ?? 0);
        }
        if (event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        continue;
      }

      if (event.type === "message_start" && event.message?.usage) {
        const u = event.message.usage;
        debug("message_start.usage", u);
        const totalIn = totalInputFromUsage(u);
        if (totalIn != null) {
          inputTokens = Math.max(inputTokens ?? 0, totalIn);
        }
        outputTokens = u.output_tokens ?? outputTokens;
        tokenCount = (inputTokens ?? 0) + (outputTokens ?? 0);
      }
      continue;
    }

    if (msg.type === "assistant") {
      if (msg.message?.usage) {
        debug("assistant.usage", msg.message.usage);
        const u = msg.message.usage;
        const totalIn = totalInputFromUsage(u);
        if (totalIn != null) {
          inputTokens = Math.max(inputTokens ?? 0, totalIn);
        }
        if (u.output_tokens != null) {
          outputTokens = Math.max(outputTokens ?? 0, u.output_tokens);
        }
        tokenCount = (inputTokens ?? 0) + (outputTokens ?? 0);
      }
      const blocks = msg.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {

        if (receivedStreamEvents && (block.type === "text" || block.type === "thinking")) {

          if (block.type === "text" && block.text && accumulatedText.length === 0) {
            accumulatedText.push(block.text);
          }
          continue;
        }
        if (block.type === "thinking" && block.thinking) {
          opts.onChunk({ chunkType: "thinking", content: block.thinking });
        } else if (block.type === "tool_use") {
          const name = block.name ?? "tool";
          opts.onChunk({
            chunkType: "tool_use",
            content: name,
            toolName: name,
            toolInput: typeof block.input === "string"
              ? block.input
              : JSON.stringify(block.input ?? {}),
          });
        } else if (block.type === "tool_result") {
          const content = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content ?? "");
          opts.onChunk({
            chunkType: "tool_result",
            content: content.slice(0, 200),
          });
        } else if (block.type === "text" && block.text) {
          accumulatedText.push(block.text);

          const words = block.text.split(/(\s+)/);
          let wordBuf = "";
          for (let i = 0; i < words.length; i++) {
            if (opts.signal?.aborted) break;
            wordBuf += words[i];
            if (i % 3 === 2 || i === words.length - 1) {
              opts.onChunk({ chunkType: "text", content: wordBuf });
              wordBuf = "";
              await new Promise<void>((r) => setTimeout(r, 12));
            }
          }
        }
      }
      continue;
    }

    if (msg.type === "result") {
      debug("result_message", {
        keys: Object.keys(msg),
        usage: msg.usage,
        total_cost_usd: msg.total_cost_usd,
        cost_usd: msg.cost_usd,
        cost: msg.cost,
        stop_reason: msg.stop_reason,
        subtype: msg.subtype,
        num_turns: msg.num_turns,
        session_id: msg.session_id?.slice(0, 12),
      });
      cost = msg.total_cost_usd ?? msg.cost_usd ?? msg.cost;
      stopReason = msg.stop_reason ?? stopReason;
      if (msg.usage) {
        debug("result.usage_full", msg.usage);
        const totalIn = totalInputFromUsage(msg.usage);
        if (totalIn != null) {
          inputTokens = Math.max(inputTokens ?? 0, totalIn);
        }
        outputTokens = msg.usage.output_tokens ?? outputTokens;
        tokenCount = (inputTokens ?? 0) + (outputTokens ?? 0);
      }

      if (accumulatedText.length === 0 && typeof msg.result === "string" && msg.result) {
        accumulatedText.push(msg.result);
        opts.onChunk({ chunkType: "text", content: msg.result });
      }

      if (stopReason === "refusal") {
        opts.onChunk({ chunkType: "error", content: "Request was declined by the model." });
      }

      opts.onChunk({
        chunkType: "system",
        content: msg.subtype ?? "done",
        cost,
        tokenUsage: msg.usage
          ? { input: totalInputFromUsage(msg.usage), output: msg.usage.output_tokens }
          : undefined,
      });
    }
  }

  const finalContent = accumulatedText.join("");

  const debugLine = JSON.stringify({
    ts: new Date().toISOString(),
    textChunks: accumulatedText.length,
    contentLen: finalContent.length,
    contentPreview: finalContent.slice(0, 80),
    sessionId: sessionId?.slice(0, 12),
    cost,
    tokenCount,
    inputTokens,
    outputTokens,
    receivedStreamEvents,
    durationMs: Date.now() - startTime,
  });
  if (process.env.ACTL_DEBUG) {
    process.stderr.write(`[actl-sdk-debug] ${debugLine}\n`);
  }

  return {
    content: finalContent,
    sessionId,
    cost,
    tokenCount,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - startTime,
    model,
    stopReason,
  };
}
