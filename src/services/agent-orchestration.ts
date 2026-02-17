
import type { AccountConfig } from "../types";
import type { NormalizedChunk } from "./stream-normalizer";
import type { EventBus, StreamChunkType } from "./event-bus";
import { throwIfAborted } from "./errors";

export const MAX_DELEGATION_DEPTH = 5;

export interface DelegationRequest {
  fromAccount: string;
  toAccount: AccountConfig;
  instruction: string;
  context?: string;
  model?: string;
  depth?: number;
  onChunk: (chunk: NormalizedChunk) => void;
  signal?: AbortSignal;
  eventBus?: EventBus;
}

export interface DelegationResult {
  content: string;
  tokenCount?: number;
  durationMs: number;
  toolCalls: { name: string; input: string; output: string }[];
}

export async function delegateToAgent(req: DelegationRequest): Promise<DelegationResult> {
  const depth = req.depth ?? 0;
  if (depth >= MAX_DELEGATION_DEPTH) {
    throw new Error(
      `Delegation depth limit reached (${MAX_DELEGATION_DEPTH}). ` +
      `Chain: cannot delegate further to prevent infinite loops.`,
    );
  }

  throwIfAborted(req.signal);

  const delegationId = crypto.randomUUID();
  const startTime = Date.now();

  req.eventBus?.emit({
    type: "DELEGATION_START",
    delegationId,
    from: req.fromAccount,
    to: req.toAccount.name,
    instruction: req.instruction.slice(0, 500),
    depth,
  });

  const systemPrompt = [
    `You are ${req.toAccount.name}, an AI agent with full filesystem access.`,
    `You've been delegated a task by ${req.fromAccount}.`,
    `Complete it using the tools available to you.`,
    `Current working directory: ${process.cwd()}`,
    req.context ? `\nContext from delegating agent:\n${req.context}` : "",
  ].filter(Boolean).join("\n");

  const childController = new AbortController();
  if (req.signal) {
    if (req.signal.aborted) {
      childController.abort();
    } else {
      req.signal.addEventListener("abort", () => childController.abort(), { once: true });
    }
  }

  const wrappedOnChunk = (chunk: NormalizedChunk) => {
    req.onChunk(chunk);
    if (req.eventBus && chunk.chunkType !== "system") {
      req.eventBus.emit({
        type: "DELEGATION_CHUNK",
        delegationId,
        from: req.fromAccount,
        to: req.toAccount.name,
        chunkType: chunk.chunkType as StreamChunkType,
        content: chunk.content.slice(0, 200),
      });
    }
  };

  const childReq: DelegationRequest = {
    ...req,
    onChunk: wrappedOnChunk,
    signal: childController.signal,
  };

  try {
    const result = req.toAccount.provider === "claude-code"
      ? await delegateViaDirect(childReq, systemPrompt, startTime)
      : await delegateViaCLI(childReq, systemPrompt, startTime);

    req.eventBus?.emit({
      type: "DELEGATION_END",
      delegationId,
      from: req.fromAccount,
      to: req.toAccount.name,
      durationMs: Date.now() - startTime,
      success: true,
      toolCallCount: result.toolCalls.length,
    });

    return result;
  } catch (err) {
    req.eventBus?.emit({
      type: "DELEGATION_END",
      delegationId,
      from: req.fromAccount,
      to: req.toAccount.name,
      durationMs: Date.now() - startTime,
      success: false,
      toolCallCount: 0,
    });
    throw err;
  }
}

async function delegateViaDirect(
  req: DelegationRequest,
  systemPrompt: string,
  startTime: number,
): Promise<DelegationResult> {
  const { getAuth } = await import("./auth-store");
  const { streamAnthropicResponse } = await import("./anthropic-client");

  const creds = await getAuth(req.toAccount.name);
  if (!creds) {
    throw new Error(
      `No auth credentials for account "${req.toAccount.name}" — run: actl config set-auth ${req.toAccount.name}`,
    );
  }

  const toolCalls: DelegationResult["toolCalls"] = [];

  const result = await streamAnthropicResponse({
    accountName: req.toAccount.name,
    creds,
    messages: [{ role: "user", content: req.instruction }],
    system: systemPrompt,
    model: req.model,
    onChunk: (chunk) => {
      req.onChunk(chunk);
      if (chunk.chunkType === "tool_use") {
        toolCalls.push({
          name: chunk.toolName ?? chunk.content,
          input: chunk.toolInput ?? "",
          output: "",
        });
      } else if (chunk.chunkType === "tool_result" && toolCalls.length > 0) {
        toolCalls[toolCalls.length - 1].output = chunk.content;
      }
    },
    signal: req.signal,
  });

  return {
    content: result.content,
    tokenCount: result.tokenCount,
    durationMs: Date.now() - startTime,
    toolCalls,
  };
}

async function delegateViaCLI(
  req: DelegationRequest,
  systemPrompt: string,
  startTime: number,
): Promise<DelegationResult> {
  const { buildProviderCommand } = await import("./council-framework");

  const prompt = `${systemPrompt}\n\n${req.instruction}`;
  const { cmd, env, parseOutput, stdinInput } = buildProviderCommand(req.toAccount, prompt);

  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const proc = Bun.spawn(cmd, {
    stdin: stdinInput ? new Response(prompt).body : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...cleanEnv, ...env },
  });

  if (req.signal) {
    req.signal.addEventListener("abort", () => proc.kill(), { once: true });
  }

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Delegation to ${req.toAccount.name} failed (exit ${exitCode}): ${stderr.slice(0, 300)}`);
  }

  const content = parseOutput(stdout.trim());
  req.onChunk({ chunkType: "text", content });

  return {
    content,
    durationMs: Date.now() - startTime,
    toolCalls: [],
  };
}
