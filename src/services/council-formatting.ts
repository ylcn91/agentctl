

export interface ToolCallSummary {
  name: string;
  input: string;
  output: string;
}

export interface DiscussionMessage {
  id: string;
  account: string;
  phase: "research" | "discussion" | "decision";
  round?: number;
  content: string;
  toolCalls?: ToolCallSummary[];
  timestamp: string;
}

export interface DiscussionConfig {
  accounts: import("../types").AccountConfig[];
  members: string[];
  chairman: string;
  goal: string;
  context?: string;
  maxRounds?: number;
  researchTimeoutMs?: number;
  discussionTimeoutMs?: number;
  decisionTimeoutMs?: number;
}

export interface DiscussionResult {
  goal: string;
  research: DiscussionMessage[];
  discussion: DiscussionMessage[];
  decision: DiscussionMessage | null;
  timestamp: string;
}

export type DiscussionEvent =
  | { type: "phase_start"; phase: string }
  | { type: "member_start"; account: string; phase: string; round?: number }
  | { type: "member_chunk"; account: string; chunkType: string; content: string }
  | { type: "member_done"; account: string; phase: string; round?: number; content: string; toolCalls?: ToolCallSummary[] }
  | { type: "phase_complete"; phase: string }
  | { type: "error"; message: string }
  | { type: "done"; result: DiscussionResult };

const MAX_MEMBER_CONTENT_CHARS = 4000;
const MAX_RESEARCH_MSG_CHARS = 2000;
const MAX_DISCUSSION_MSG_CHARS = 1000;
const RESEARCH_HEAD_CHARS = 500;
const RESEARCH_TAIL_CHARS = 500;
const DISCUSSION_HEAD_CHARS = 800;

export { MAX_MEMBER_CONTENT_CHARS };

export function formatPriorMessages(messages: DiscussionMessage[]): string {
  return messages
    .map((m) => {
      const header = m.phase === "research"
        ? `[Research by ${m.account}]`
        : m.phase === "discussion"
          ? `[${m.account} — Round ${m.round ?? "?"}]`
          : `[Decision by ${m.account}]`;
      const toolInfo = m.toolCalls?.length
        ? `\n(Used ${m.toolCalls.length} tool calls: ${m.toolCalls.map((t) => t.name).join(", ")})`
        : "";
      const content = m.phase === "research"
        ? truncateResearchContent(m.content)
        : truncateDiscussionContent(m.content);
      return `${header}${toolInfo}\n${content}`;
    })
    .join("\n\n---\n\n");
}

function truncateResearchContent(content: string): string {
  if (content.length <= MAX_RESEARCH_MSG_CHARS) return content;
  const head = content.slice(0, RESEARCH_HEAD_CHARS);
  const tail = content.slice(-RESEARCH_TAIL_CHARS);
  const omitted = content.length - RESEARCH_HEAD_CHARS - RESEARCH_TAIL_CHARS;
  return `${head}\n\n...${omitted} chars omitted...\n\n${tail}`;
}

function truncateDiscussionContent(content: string): string {
  if (content.length <= MAX_DISCUSSION_MSG_CHARS) return content;
  return `${content.slice(0, DISCUSSION_HEAD_CHARS)}\n\n...(${content.length - DISCUSSION_HEAD_CHARS} chars truncated)`;
}

export class BoundedContentAccumulator {
  private parts: string[] = [];
  private totalChars = 0;

  push(text: string): void {
    this.parts.push(text);
    this.totalChars += text.length;
  }

  join(maxChars = MAX_MEMBER_CONTENT_CHARS): string {
    const full = this.parts.join("");
    if (full.length <= maxChars) return full;
    const omitted = full.length - maxChars;
    return `...(${omitted} chars omitted)...\n${full.slice(-maxChars)}`;
  }

  get length(): number {
    return this.totalChars;
  }
}

export function formatToolCallsSummary(toolCalls: ToolCallSummary[]): string {
  if (toolCalls.length === 0) return "";
  return toolCalls
    .map((t) => `- ${t.name}: ${t.input.slice(0, 80)}`)
    .join("\n");
}

export const COMPACTION_THRESHOLD_BYTES = 20_000;

export function measureMessages(messages: DiscussionMessage[]): number {
  return messages.reduce((sum, m) => sum + Buffer.byteLength(m.content, "utf-8"), 0);
}

export function stripToolPreviews(messages: DiscussionMessage[]): DiscussionMessage[] {
  return messages.map((m) => {
    if (m.phase !== "research" || !m.toolCalls?.length) return m;
    const toolSummary = m.toolCalls
      .map((t) => `- ${t.name}: ${t.input.slice(0, 60)}`)
      .join("\n");
    return { ...m, content: `${m.content}\n\nTools used:\n${toolSummary}` };
  });
}

const COMPACTION_PROMPT = `Summarize the council discussion below for the chairman's final decision.
Preserve:
- Key findings with specific file paths and line numbers
- Areas of agreement and disagreement between members
- Concrete recommendations and alternatives discussed
- Any caveats or risks identified

Use this structure:
## Key Findings
[Bullet points of specific discoveries with file refs]

## Consensus
[What members agreed on]

## Disagreements
[Where members differed and their reasoning]

## Recommendations
[Concrete action items]`;

export async function compactForDecision(
  messages: DiscussionMessage[],
  goal: string,
  opts: {
    accountName: string;
    creds: import("./auth-store").AuthCredentials;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<{ text: string; compacted: boolean }> {
  const size = measureMessages(messages);
  if (size < COMPACTION_THRESHOLD_BYTES) {
    return { text: formatPriorMessages(messages), compacted: false };
  }

  const stripped = stripToolPreviews(messages);
  const formatted = formatPriorMessages(stripped);

  try {
    const { streamSimpleResponse } = await import("./anthropic-client.js");
    const abortController = new AbortController();
    const timerId = setTimeout(
      () => abortController.abort(),
      opts.timeoutMs ?? 30_000,
    );

    if (opts.signal) {
      opts.signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }

    try {
      const result = await streamSimpleResponse({
        accountName: opts.accountName,
        creds: opts.creds,
        system: COMPACTION_PROMPT,
        userPrompt: `Goal: ${goal}\n\n${formatted}`,
        onChunk: () => {},
        signal: abortController.signal,
      });
      return { text: result.content || formatted, compacted: true };
    } finally {
      clearTimeout(timerId);
    }
  } catch {

    return { text: formatted, compacted: false };
  }
}
