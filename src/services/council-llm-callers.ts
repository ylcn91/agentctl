
import type { AccountConfig } from "../types";
import type { EventBus } from "./event-bus";
import type { NormalizedChunk } from "./stream-normalizer";
import { getNormalizer } from "./stream-normalizer";
import { createLineParser } from "../daemon/framing";
import { throwIfAborted } from "./errors";
import { buildProviderCommand, type LLMCaller, type StreamingLLMCaller } from "./council-framework";

export const DEFAULT_TIMEOUT_MS = 30_000;

export class LLMTimeoutError extends Error {
  public readonly account: string;
  public readonly timeoutMs: number;

  constructor(account: string, timeoutMs: number) {
    super(`Account ${account} LLM call timed out after ${timeoutMs}ms`);
    this.name = "LLMTimeoutError";
    this.account = account;
    this.timeoutMs = timeoutMs;
  }
}

export function createAccountCaller(accounts: AccountConfig[], timeoutMs?: number): LLMCaller {
  const accountMap = new Map<string, AccountConfig>();
  for (const acc of accounts) accountMap.set(acc.name, acc);
  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (accountName: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> => {
    const account = accountMap.get(accountName);
    if (!account) throw new Error(`Account not found: ${accountName}`);
    throwIfAborted(signal);

    if (account.provider === "claude-code") {
      const { getAuth } = await import("./auth-store");
      const { streamSimpleResponse } = await import("./anthropic-client");
      const creds = await getAuth(accountName);
      if (!creds) throw new Error(`No auth credentials for account "${accountName}" — run: actl config set-auth ${accountName}`);

      const abortController = new AbortController();
      const timerId = setTimeout(() => abortController.abort(), effectiveTimeout);
      if (signal) signal.addEventListener("abort", () => abortController.abort(), { once: true });

      try {
        const result = await streamSimpleResponse({
          accountName, creds, system: systemPrompt, userPrompt,
          onChunk: () => {}, signal: abortController.signal,
        });
        return result.content;
      } catch (err: any) {
        if (abortController.signal.aborted) throw new LLMTimeoutError(accountName, effectiveTimeout);
        throw err;
      } finally {
        clearTimeout(timerId);
      }
    }

    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    const { cmd, env, parseOutput, stdinInput } = buildProviderCommand(account, prompt);
    const { CLAUDECODE: _, ...cleanEnv } = process.env;
    const proc = Bun.spawn(cmd, {
      stdin: stdinInput ? new Response(prompt).body : undefined,
      stdout: "pipe", stderr: "pipe", env: { ...cleanEnv, ...env },
    });
    if (signal) signal.addEventListener("abort", () => proc.kill(), { once: true });

    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => { proc.kill(); reject(new LLMTimeoutError(accountName, effectiveTimeout)); }, effectiveTimeout);
    });

    const resultPromise = (async () => {
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`Account ${accountName} CLI exited with code ${exitCode}: ${stderr.slice(0, 500)}`);
      }
      return parseOutput(stdout.trim());
    })();

    try {
      return await Promise.race([resultPromise, timeoutPromise]);
    } finally {
      clearTimeout(timerId);
    }
  };
}

export function createStreamingAccountCaller(
  accounts: AccountConfig[], eventBus: EventBus, timeoutMs?: number,
): StreamingLLMCaller {
  const accountMap = new Map<string, AccountConfig>();
  for (const acc of accounts) accountMap.set(acc.name, acc);
  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (accountName, systemPrompt, userPrompt, onChunk?, signal?) => {
    const account = accountMap.get(accountName);
    if (!account) throw new Error(`Account not found: ${accountName}`);
    throwIfAborted(signal);

    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    const sessionId = crypto.randomUUID();
    const startTime = Date.now();

    eventBus.emit({
      type: "AGENT_STREAM_START", sessionId, account: accountName,
      provider: account.provider, prompt: prompt.slice(0, 200),
    });

    if (account.provider === "claude-code") {
      const { getAuth } = await import("./auth-store");
      const { streamSimpleResponse } = await import("./anthropic-client");
      const creds = await getAuth(accountName);
      if (!creds) throw new Error(`No auth credentials for account "${accountName}" — run: actl config set-auth ${accountName}`);

      const abortController = new AbortController();
      const timerId = setTimeout(() => abortController.abort(), effectiveTimeout);
      if (signal) signal.addEventListener("abort", () => abortController.abort(), { once: true });

      try {
        const result = await streamSimpleResponse({
          accountName, creds, system: systemPrompt, userPrompt,
          onChunk: (chunk) => {
            eventBus.emit({
              type: "AGENT_STREAM_CHUNK", sessionId, account: accountName,
              chunkType: chunk.chunkType, content: chunk.content,
            });
            onChunk?.(chunk);
          },
          signal: abortController.signal,
        });
        eventBus.emit({ type: "AGENT_STREAM_END", sessionId, account: accountName, durationMs: Date.now() - startTime, tokenCount: result.tokenCount });
        return result.content;
      } catch (err: any) {
        eventBus.emit({ type: "AGENT_STREAM_END", sessionId, account: accountName, durationMs: Date.now() - startTime });
        if (abortController.signal.aborted) throw new LLMTimeoutError(accountName, effectiveTimeout);
        throw err;
      } finally {
        clearTimeout(timerId);
      }
    }

    return streamViaCLI(account, accountName, prompt, sessionId, startTime, effectiveTimeout, eventBus, onChunk, signal);
  };
}

async function streamViaCLI(
  account: AccountConfig, accountName: string, prompt: string, sessionId: string,
  startTime: number, effectiveTimeout: number, eventBus: EventBus,
  onChunk?: (chunk: NormalizedChunk) => void, signal?: AbortSignal,
): Promise<string> {
  const { cmd, env, stdinInput } = buildProviderCommand(account, prompt, { streaming: true });
  const normalizer = getNormalizer(account.provider);
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const proc = Bun.spawn(cmd, {
    stdin: stdinInput ? new Response(prompt).body : undefined,
    stdout: "pipe", stderr: "pipe", env: { ...cleanEnv, ...env },
  });
  if (signal) signal.addEventListener("abort", () => proc.kill(), { once: true });

  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => { proc.kill(); reject(new LLMTimeoutError(accountName, effectiveTimeout)); }, effectiveTimeout);
  });

  const resultPromise = (async () => {
    const accumulatedText: string[] = [];
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let tokenCount: number | undefined;
    let cost: number | undefined;
    const isJsonStreaming = account.provider === "opencode" || account.provider === "cursor-agent";

    if (isJsonStreaming) {
      const parser = createLineParser((json) => {
        const chunk = normalizer(json);
        if (!chunk) return;
        accumulatedText.push(chunk.content);
        if (chunk.tokenUsage) tokenCount = (chunk.tokenUsage.input ?? 0) + (chunk.tokenUsage.output ?? 0);
        if (chunk.cost !== undefined) cost = chunk.cost;
        eventBus.emit({ type: "AGENT_STREAM_CHUNK", sessionId, account: accountName, chunkType: chunk.chunkType, content: chunk.content, toolName: chunk.toolName, toolInput: chunk.toolInput });
        onChunk?.(chunk);
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
          accumulatedText.push(chunk.content);
          eventBus.emit({ type: "AGENT_STREAM_CHUNK", sessionId, account: accountName, chunkType: chunk.chunkType, content: chunk.content });
          onChunk?.(chunk);
        }
      }
      if (lineBuffer.trim()) {
        const chunk = normalizer(lineBuffer);
        if (chunk) {
          accumulatedText.push(chunk.content);
          eventBus.emit({ type: "AGENT_STREAM_CHUNK", sessionId, account: accountName, chunkType: chunk.chunkType, content: chunk.content });
          onChunk?.(chunk);
        }
      }
    }

    const exitCode = await proc.exited;
    eventBus.emit({ type: "AGENT_STREAM_END", sessionId, account: accountName, durationMs: Date.now() - startTime, tokenCount, cost });
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Account ${accountName} CLI exited with code ${exitCode}: ${stderr.slice(0, 500)}`);
    }
    return accumulatedText.join("");
  })();

  try {
    return await Promise.race([resultPromise, timeoutPromise]);
  } finally {
    clearTimeout(timerId);
  }
}
