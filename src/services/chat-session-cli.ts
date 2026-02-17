
import type { AccountConfig } from "../types";
import type { NormalizedChunk } from "./stream-normalizer";
import type { MessagePart, ChatMessage } from "./chat-session";
import { buildProviderCommand } from "./council-framework";
import { getNormalizer } from "./stream-normalizer";
import { createLineParser } from "../daemon/framing";

export function buildPrompt(messages: ChatMessage[]): string {
  if (messages.length === 1) {
    return messages[0].content;
  }

  const turns = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  return `<conversation>\n${turns}\n</conversation>\n\nContinue this conversation. Respond to the latest message.`;
}

export interface SendViaCliOptions {

  onProcess?: (proc: ReturnType<typeof Bun.spawn>) => void;

  model?: string;
}

export async function sendViaCli(
  account: AccountConfig,
  messages: ChatMessage[],
  onChunk: (chunk: NormalizedChunk) => void,
  options?: SendViaCliOptions,
): Promise<ChatMessage> {
  const prompt = buildPrompt(messages);
  const { cmd, env, stdinInput } = buildProviderCommand(account, prompt, { streaming: true, model: options?.model });
  const normalizer = getNormalizer(account.provider);
  const startTime = Date.now();

  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const proc = Bun.spawn(cmd, {
    stdin: stdinInput ? new Response(prompt).body : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...cleanEnv, ...env },
  });
  options?.onProcess?.(proc);

  const accumulatedText: string[] = [];
  const parts: MessagePart[] = [];
  const pending: { tool: { name: string; input?: string; startTime: number } | null } = { tool: null };
  let tokenCount: number | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cost: number | undefined;

  const processChunk = (chunk: NormalizedChunk) => {
    if (chunk.chunkType === "text") {
      accumulatedText.push(chunk.content);
      const last = parts[parts.length - 1];
      if (last?.type === "text") {
        last.text += chunk.content;
      } else {
        parts.push({ type: "text", text: chunk.content });
      }
    } else if (chunk.chunkType === "thinking") {
      const last = parts[parts.length - 1];
      if (last?.type === "thinking") {
        last.text += chunk.content;
      } else {
        parts.push({ type: "thinking", text: chunk.content });
      }
    } else if (chunk.chunkType === "tool_use") {
      pending.tool = { name: chunk.toolName ?? chunk.content, input: chunk.toolInput, startTime: Date.now() };
      parts.push({ type: "tool", name: chunk.toolName ?? chunk.content, status: "running", input: chunk.toolInput });
    } else if (chunk.chunkType === "tool_result") {
      if (pending.tool) {
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          if (p.type === "tool" && p.name === pending.tool.name && p.status === "running") {
            p.status = "completed";
            p.output = chunk.content;
            p.durationMs = Date.now() - pending.tool.startTime;
            break;
          }
        }
        pending.tool = null;
      }
    } else if (chunk.chunkType === "error") {
      parts.push({ type: "error", text: chunk.content });
    }
    if (chunk.tokenUsage) {
      inputTokens = chunk.tokenUsage.input ?? inputTokens;
      outputTokens = chunk.tokenUsage.output ?? outputTokens;
      tokenCount = (inputTokens ?? 0) + (outputTokens ?? 0);
    }
    if (chunk.cost !== undefined) cost = chunk.cost;
    onChunk(chunk);
  };

  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const isJsonStreaming =
    account.provider === "claude-code" || account.provider === "opencode" || account.provider === "cursor-agent";

  if (isJsonStreaming) {
    const parser = createLineParser((json) => {
      const chunk = normalizer(json);
      if (!chunk) return;
      processChunk(chunk);
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } else {
    let lineBuffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = normalizer(line);
        if (!chunk) continue;
        processChunk(chunk);
      }
    }
    if (lineBuffer.trim()) {
      const chunk = normalizer(lineBuffer);
      if (chunk) processChunk(chunk);
    }
  }

  const exitCode = await proc.exited;
  const durationMs = Date.now() - startTime;

  const wasKilled = exitCode === 143 || exitCode === 137;
  if (exitCode !== 0 && !(wasKilled && accumulatedText.length > 0)) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Account ${account.name} CLI exited with code ${exitCode}: ${stderr.slice(0, 500)}`,
    );
  }

  const assistantMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: accumulatedText.join(""),
    timestamp: new Date().toISOString(),
    tokenCount,
    inputTokens,
    outputTokens,
    cost,
    durationMs,
    parts: parts.length > 0 ? parts : undefined,
  };

  return assistantMsg;
}
