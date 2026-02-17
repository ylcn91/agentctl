
import type { AccountConfig } from "../types";
import type { AuthCredentials } from "./auth-store";
import {
  formatPriorMessages,
  BoundedContentAccumulator,
  compactForDecision,
  type ToolCallSummary,
  type DiscussionMessage,
  type DiscussionConfig,
  type DiscussionResult,
  type DiscussionEvent,
} from "./council-formatting.js";
import { createChunkQueue } from "./chunk-queue.js";

export type { ToolCallSummary, DiscussionMessage, DiscussionConfig, DiscussionResult, DiscussionEvent };

function makeMessage(account: string, phase: DiscussionMessage["phase"], content: string, toolCalls?: ToolCallSummary[], round?: number): DiscussionMessage {
  return { id: crypto.randomUUID(), account, phase, round, content, toolCalls: toolCalls?.length ? toolCalls : undefined, timestamp: new Date().toISOString() };
}

async function getCredsForAccount(accountName: string, accounts: AccountConfig[]): Promise<{ creds: AuthCredentials; account: AccountConfig }> {
  const account = accounts.find((a) => a.name === accountName);
  if (!account) throw new Error(`Account not found: ${accountName}`);
  const { getAuth } = await import("./auth-store");
  const creds = await getAuth(accountName);
  if (!creds) throw new Error(`No auth credentials for account "${accountName}" — run: actl config set-auth ${accountName}`);
  return { creds, account };
}

function createChunkTracker(account: string, onEvent: (e: DiscussionEvent) => void) {
  const accumulator = new BoundedContentAccumulator();
  const toolCalls: ToolCallSummary[] = [];
  const queue = createChunkQueue((batch) => {
    for (const chunk of batch) {
      onEvent({ type: "member_chunk", account, chunkType: chunk.chunkType, content: chunk.content });
    }
  });

  const onChunk = async (chunk: { chunkType: string; content: string; toolName?: string; toolInput?: string }) => {
    if (chunk.chunkType === "text") accumulator.push(chunk.content);
    else if (chunk.chunkType === "tool_use" && chunk.toolName) toolCalls.push({ name: chunk.toolName, input: (chunk.toolInput ?? "").slice(0, 200), output: "" });
    else if (chunk.chunkType === "tool_result" && toolCalls.length > 0) toolCalls[toolCalls.length - 1].output = chunk.content.slice(0, 200);
    await queue.push(chunk as any);
  };
  return { accumulator, toolCalls, onChunk, flushQueue: () => queue.flush() };
}

const log = (_msg: string) => {};

async function runResearchPhase(
  members: string[],
  accounts: AccountConfig[],
  goal: string,
  context: string | undefined,
  timeoutMs: number,
  onEvent: (event: DiscussionEvent) => void,
): Promise<DiscussionMessage[]> {
  log(`research: starting with ${members.length} members, timeout=${timeoutMs}ms`);
  onEvent({ type: "phase_start", phase: "research" });

  const cwd = process.cwd();
  const contextBlock = context ? `\n\nAdditional context:\n${context}` : "";

  const tasks = members.map(async (memberName) => {
    onEvent({ type: "member_start", account: memberName, phase: "research" });

    const { creds, account } = await getCredsForAccount(memberName, accounts);
    if (account.provider !== "claude-code") {
      const { streamSimpleResponse } = await import("./anthropic-client");
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const result = await streamSimpleResponse({
          accountName: memberName, creds,
          system: `You are ${memberName}, a council member. Investigate the goal and provide a detailed research report with findings and recommendations. CWD: ${cwd}`,
          userPrompt: `Goal: ${goal}${contextBlock}\n\nProvide your detailed analysis.`,
          onChunk: (chunk) => onEvent({ type: "member_chunk", account: memberName, chunkType: chunk.chunkType, content: chunk.content }),
          signal: ac.signal,
        });
        onEvent({ type: "member_done", account: memberName, phase: "research", content: result.content });
        return makeMessage(memberName, "research", result.content);
      } finally { clearTimeout(tid); }
    }

    const { streamAnthropicResponse } = await import("./anthropic-client");
    const { accumulator, toolCalls, onChunk, flushQueue } = createChunkTracker(memberName, onEvent);
    const abortController = new AbortController();
    const timerId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      await streamAnthropicResponse({
        accountName: memberName, creds,
        system: `You are ${memberName}, a council member. Investigate the goal by ACTUALLY reading the codebase. Use tools: read files, grep, run commands. Report specific findings with evidence. CWD: ${cwd}`,
        messages: [{ role: "user", content: `Goal: ${goal}${contextBlock}\n\nInvestigate now. Use tools to read relevant files and gather evidence.` }],
        onChunk, signal: abortController.signal,
      });
      await flushQueue();
      const content = accumulator.join();
      onEvent({ type: "member_done", account: memberName, phase: "research", content, toolCalls });
      return makeMessage(memberName, "research", content, toolCalls);
    } finally {
      clearTimeout(timerId);
    }
  });

  const results = await Promise.allSettled(tasks);
  const messages: DiscussionMessage[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      messages.push(r.value);
    } else {
      log(`research: member failed: ${r.reason?.message ?? r.reason}`);
    }
  }

  log(`research: completed with ${messages.length}/${members.length} results`);
  onEvent({ type: "phase_complete", phase: "research" });
  return messages;
}

async function runDiscussionRound(
  members: string[],
  accounts: AccountConfig[],
  roundNum: number,
  allPriorMessages: DiscussionMessage[],
  goal: string,
  timeoutMs: number,
  onEvent: (event: DiscussionEvent) => void,
): Promise<DiscussionMessage[]> {
  const roundMessages: DiscussionMessage[] = [];
  const formattedPrior = formatPriorMessages(allPriorMessages);

  for (const memberName of members) {
    onEvent({ type: "member_start", account: memberName, phase: "discussion", round: roundNum });
    const { creds } = await getCredsForAccount(memberName, accounts);
    const { streamSimpleResponse } = await import("./anthropic-client");
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const extra = roundMessages.length > 0 ? `\n\n--- Earlier in Round ${roundNum} ---\n\n${formatPriorMessages(roundMessages)}` : "";
      const result = await streamSimpleResponse({
        accountName: memberName, creds,
        system: `You are ${memberName}, a council discussion member. Round ${roundNum}. Respond to findings: agree, disagree, challenge weak points, add nuance. Be specific with code references. Keep concise.`,
        userPrompt: `Goal: ${goal}\n\nResearch and discussion so far:\n${formattedPrior}${extra}\n\nProvide your response for Round ${roundNum}.`,
        onChunk: (chunk) => onEvent({ type: "member_chunk", account: memberName, chunkType: chunk.chunkType, content: chunk.content }),
        signal: ac.signal,
      });
      roundMessages.push(makeMessage(memberName, "discussion", result.content, undefined, roundNum));
      onEvent({ type: "member_done", account: memberName, phase: "discussion", round: roundNum, content: result.content });
    } catch (err: any) {
      const errContent = `(Error: ${err.message?.slice(0, 100) ?? "unknown"})`;
      roundMessages.push(makeMessage(memberName, "discussion", errContent, undefined, roundNum));
      onEvent({ type: "member_done", account: memberName, phase: "discussion", round: roundNum, content: errContent });
    } finally { clearTimeout(tid); }
  }

  return roundMessages;
}

async function runDiscussionRounds(
  members: string[],
  accounts: AccountConfig[],
  researchMessages: DiscussionMessage[],
  goal: string,
  maxRounds: number,
  timeoutMs: number,
  onEvent: (event: DiscussionEvent) => void,
): Promise<DiscussionMessage[]> {
  log(`discussion: starting ${maxRounds} rounds with ${members.length} members`);
  onEvent({ type: "phase_start", phase: "discussion" });

  const allDiscussionMessages: DiscussionMessage[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    log(`discussion: round ${round}/${maxRounds}`);
    const allPrior = [...researchMessages, ...allDiscussionMessages];
    const roundMessages = await runDiscussionRound(
      members, accounts, round, allPrior, goal, timeoutMs, onEvent,
    );
    allDiscussionMessages.push(...roundMessages);
  }

  onEvent({ type: "phase_complete", phase: "discussion" });
  return allDiscussionMessages;
}

async function runDecisionPhase(
  chairmanName: string,
  accounts: AccountConfig[],
  formattedContext: string,
  goal: string,
  timeoutMs: number,
  onEvent: (event: DiscussionEvent) => void,
): Promise<DiscussionMessage | null> {
  onEvent({ type: "phase_start", phase: "decision" });
  onEvent({ type: "member_start", account: chairmanName, phase: "decision" });

  const { creds, account } = await getCredsForAccount(chairmanName, accounts);
  const cwd = process.cwd();

  const decisionSystemBase = [
    `You are ${chairmanName}, the chairman of this code analysis council.`,
    `Below is the full research and discussion from all members.`,
    `Make a FINAL DECISION. Your decision must include:`,
    `- What specific approach to take (with file paths, commands, etc.)`,
    `- Why this approach was chosen over alternatives discussed`,
    `- Any caveats or risks identified during discussion`,
  ];
  const userPromptText = `Goal: ${goal}\n\nFull research and discussion:\n${formattedContext}\n\nMake your final decision now.`;

  const abortController = new AbortController();
  const timerId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    if (account.provider === "claude-code") {
      const { streamAnthropicResponse } = await import("./anthropic-client");
      const { accumulator, toolCalls, onChunk, flushQueue } = createChunkTracker(chairmanName, onEvent);
      await streamAnthropicResponse({
        accountName: chairmanName, creds,
        system: [...decisionSystemBase, `You may use tools to verify claims.`, `CWD: ${cwd}`].join("\n"),
        messages: [{ role: "user", content: userPromptText }],
        onChunk, signal: abortController.signal,
      });
      await flushQueue();
      const content = accumulator.join();
      onEvent({ type: "member_done", account: chairmanName, phase: "decision", content, toolCalls });
      onEvent({ type: "phase_complete", phase: "decision" });
      return makeMessage(chairmanName, "decision", content, toolCalls);
    }

    const { streamSimpleResponse } = await import("./anthropic-client");
    const result = await streamSimpleResponse({
      accountName: chairmanName, creds, system: decisionSystemBase.join("\n"),
      userPrompt: userPromptText,
      onChunk: (chunk) => onEvent({ type: "member_chunk", account: chairmanName, chunkType: chunk.chunkType, content: chunk.content }),
      signal: abortController.signal,
    });
    onEvent({ type: "member_done", account: chairmanName, phase: "decision", content: result.content });
    onEvent({ type: "phase_complete", phase: "decision" });
    return makeMessage(chairmanName, "decision", result.content);
  } finally {
    clearTimeout(timerId);
  }
}

function emptyResult(goal: string): DiscussionResult {
  return { goal, research: [], discussion: [], decision: null, timestamp: new Date().toISOString() };
}

export async function runCouncilDiscussion(
  config: DiscussionConfig,
  onEvent: (event: DiscussionEvent) => void,
): Promise<DiscussionResult> {
  const { accounts, members, chairman, goal, context,
    maxRounds = 2, researchTimeoutMs = 120_000,
    discussionTimeoutMs = 60_000, decisionTimeoutMs = 120_000,
  } = config;

  if (members.length === 0) {
    const result = emptyResult(goal);
    onEvent({ type: "error", message: "No members provided for council discussion" });
    onEvent({ type: "done", result });
    return result;
  }

  try {
    log(`starting: members=[${members.join(",")}] chair=${chairman} rounds=${maxRounds}`);
    const research = await runResearchPhase(members, accounts, goal, context, researchTimeoutMs, onEvent);
    if (research.length === 0) {
      const result = emptyResult(goal);
      onEvent({ type: "error", message: "No research results — all members failed or timed out" });
      onEvent({ type: "done", result });
      return result;
    }

    const discussion = await runDiscussionRounds(members, accounts, research, goal, maxRounds, discussionTimeoutMs, onEvent);

    const allMessages = [...research, ...discussion];
    const { creds: chairCreds } = await getCredsForAccount(chairman, accounts);
    const { text: decisionContext } = await compactForDecision(allMessages, goal, {
      accountName: chairman, creds: chairCreds, timeoutMs: 30_000,
    });
    log(`decision: starting chairman=${chairman}`);
    const decision = await runDecisionPhase(chairman, accounts, decisionContext, goal, decisionTimeoutMs, onEvent);
    log(`decision: complete`);
    const result: DiscussionResult = { goal, research, discussion, decision, timestamp: new Date().toISOString() };

    try { const { appendDiscussionResult } = await import("./council-store"); await appendDiscussionResult(result); } catch {}

    onEvent({ type: "done", result });
    return result;
  } catch (err: any) {
    const result = emptyResult(goal);
    onEvent({ type: "error", message: err.message ?? "Council discussion failed" });
    onEvent({ type: "done", result });
    return result;
  }
}
