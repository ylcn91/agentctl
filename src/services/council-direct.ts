
import type { AccountConfig } from "../types";
import { throwIfAborted } from "./errors";
import { createStreamingAccountCaller } from "./council-llm-callers";

export type CouncilDirectEvent =
  | { type: "stage_start"; stage: string }
  | { type: "member_start"; account: string; stage: string }
  | { type: "member_chunk"; account: string; chunkType: string; content: string }
  | { type: "member_response"; account: string; stage: string; content: string; role: "member" | "chairman" }
  | { type: "stage_complete"; stage: string }
  | { type: "error"; message: string }
  | { type: "done"; analysis: any };

export interface DirectCouncilOpts {
  accounts: AccountConfig[];
  members: string[];
  chairman: string;
  goal: string;
  context?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent: (event: CouncilDirectEvent) => void;
}

export async function runCouncilDirect(opts: DirectCouncilOpts): Promise<void> {
  const { accounts, members, chairman, goal, context, timeoutMs = 120_000, signal, onEvent } = opts;
  const { CouncilService, calculateAggregateRankings } = await import("./council");
  const { appendCouncilAnalysis } = await import("./council-store");
  const eventBus = new (await import("./event-bus")).EventBus({ maxRecent: 200 });

  eventBus.on("*", (event: any) => {
    if (event.type === "AGENT_STREAM_CHUNK" && event.account) {
      onEvent({ type: "member_chunk", account: event.account, chunkType: event.chunkType ?? "text", content: event.content ?? "" });
    } else if (event.type === "AGENT_STREAM_START" && event.account) {
      onEvent({ type: "member_start", account: event.account, stage: "analysis" });
    }
  });

  const caller = createStreamingAccountCaller(accounts, eventBus, timeoutMs);
  const council = new CouncilService({ members, chairman, timeoutMs }, caller);

  try {
    throwIfAborted(signal);
    onEvent({ type: "stage_start", stage: "analysis" });
    const individualAnalyses = await council.stage1_collectAnalyses(goal, context);
    if (individualAnalyses.length === 0) {
      onEvent({ type: "error", message: "No analyses returned — all accounts failed or timed out" });
      return;
    }
    for (const analysis of individualAnalyses) {
      onEvent({ type: "member_response", account: analysis.account, stage: "analysis", content: analysis.recommendedApproach ?? "", role: "member" });
    }
    onEvent({ type: "stage_complete", stage: "analysis" });

    throwIfAborted(signal);
    onEvent({ type: "stage_start", stage: "peer_review" });
    const peerRankings = await council.stage2_peerReview(goal, individualAnalyses);
    for (const ranking of peerRankings) {
      onEvent({ type: "member_response", account: ranking.reviewer, stage: "peer_review", content: JSON.stringify(ranking.ranking), role: "member" });
    }
    onEvent({ type: "stage_complete", stage: "peer_review" });

    throwIfAborted(signal);
    onEvent({ type: "stage_start", stage: "synthesis" });
    const aggregateRankings = calculateAggregateRankings(peerRankings, individualAnalyses.map((a: any) => a.account));
    const synthesis = await council.stage3_synthesize(goal, individualAnalyses, peerRankings);
    onEvent({ type: "member_response", account: chairman, stage: "synthesis", content: synthesis.recommendedApproach ?? "", role: "chairman" });
    onEvent({ type: "stage_complete", stage: "synthesis" });

    const analysis = { taskGoal: goal, timestamp: new Date().toISOString(), individualAnalyses, peerRankings, aggregateRankings, synthesis };
    try { await appendCouncilAnalysis(analysis); } catch {  }
    onEvent({ type: "done", analysis });
  } catch (err: any) {
    onEvent({ type: "error", message: err.message ?? "Council analysis failed" });
  } finally {
    eventBus.clear();
  }
}

export interface DirectDiscussionOpts {
  accounts: AccountConfig[];
  members: string[];
  chairman: string;
  goal: string;
  context?: string;
  maxRounds?: number;
  researchTimeoutMs?: number;
  discussionTimeoutMs?: number;
  decisionTimeoutMs?: number;
  signal?: AbortSignal;
  onEvent: (event: import("./council-discussion").DiscussionEvent) => void;
}

export async function runCouncilDiscussionDirect(opts: DirectDiscussionOpts): Promise<void> {
  const { runCouncilDiscussion } = await import("./council-discussion");

  try {
    await runCouncilDiscussion(
      {
        accounts: opts.accounts, members: opts.members, chairman: opts.chairman,
        goal: opts.goal, context: opts.context, maxRounds: opts.maxRounds,
        researchTimeoutMs: opts.researchTimeoutMs, discussionTimeoutMs: opts.discussionTimeoutMs,
        decisionTimeoutMs: opts.decisionTimeoutMs,
      },
      opts.onEvent,
    );
  } catch (err: any) {
    opts.onEvent({ type: "error", message: err.message ?? "Council discussion failed" });
  }
}
