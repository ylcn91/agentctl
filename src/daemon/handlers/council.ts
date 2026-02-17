import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";
import { loadConfig } from "../../config";

function guardCouncil(ctx: HandlerContext, socket: Socket, msg: any): false | void {
  const { features, safeWrite, reply } = ctx;
  if (!features?.council) { safeWrite(socket, reply(msg, { type: "error", error: "Council feature not enabled" })); return false; }
}

function guardField(ctx: HandlerContext, socket: Socket, msg: any, field: string, type = "string"): false | void {
  if (type === "string" && (typeof msg[field] !== "string" || !msg[field])) {
    ctx.safeWrite(socket, ctx.reply(msg, { type: "error", error: `Invalid field: ${field}` }));
    return false;
  }
  if (type === "array" && !Array.isArray(msg[field])) {
    ctx.safeWrite(socket, ctx.reply(msg, { type: "error", error: `Invalid field: ${field}` }));
    return false;
  }
}

async function getCouncilConfig(ctx: HandlerContext) {
  const fullConfig = await loadConfig();
  const council_config = ctx.councilConfig ?? fullConfig.council;
  return { fullConfig, council_config };
}

export function registerCouncilHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { features, safeWrite, reply } = ctx;

  return {
    council_analyze: async (socket: Socket, msg: any) => {
      if (guardCouncil(ctx, socket, msg) === false) return;
      if (guardField(ctx, socket, msg, "goal") === false) return;
      try {
        const { CouncilService, createAccountCaller } = await import("../../services/council");
        const { fullConfig, council_config } = await getCouncilConfig(ctx);
        if (!council_config) { safeWrite(socket, reply(msg, { type: "error", error: "Council not configured" })); return; }
        const timeoutMs = msg.timeoutMs ?? council_config.timeoutMs;

        let llmCaller;
        const councilSessionId = crypto.randomUUID();
        if (features?.streaming) {
          const { createStreamingAccountCaller } = await import("../../services/council-framework");
          const eventBus = ctx.state.eventBus;
          eventBus.emit({ type: "COUNCIL_SESSION_START", councilSessionId, goal: msg.goal, stage: "analysis", members: council_config.members });
          llmCaller = createStreamingAccountCaller(fullConfig.accounts, eventBus, timeoutMs);
        } else {
          llmCaller = createAccountCaller(fullConfig.accounts, timeoutMs);
        }

        const council = new CouncilService(council_config, llmCaller);
        const eventBus = ctx.state.eventBus;
        let analysis;

        if (features?.streaming) {
          const individualAnalyses = await council.stage1_collectAnalyses(msg.goal, msg.context);
          for (const a of individualAnalyses) {
            eventBus.emit({ type: "COUNCIL_MEMBER_RESPONSE", councilSessionId, account: a.account, stage: "analysis", content: a.recommendedApproach ?? "", role: "member" });
          }
          eventBus.emit({ type: "COUNCIL_STAGE_COMPLETE", councilSessionId, stage: "analysis", results: individualAnalyses.length });

          const peerRankings = await council.stage2_peerReview(msg.goal, individualAnalyses);
          for (const r of peerRankings) {
            eventBus.emit({ type: "COUNCIL_MEMBER_RESPONSE", councilSessionId, account: r.reviewer, stage: "peer_review", content: JSON.stringify(r.ranking), role: "member" });
          }
          eventBus.emit({ type: "COUNCIL_STAGE_COMPLETE", councilSessionId, stage: "peer_review", results: peerRankings.length });

          const { calculateAggregateRankings } = await import("../../services/council");
          const aggregateRankings = calculateAggregateRankings(peerRankings, individualAnalyses.map((a: any) => a.account));
          const synthesis = await council.stage3_synthesize(msg.goal, individualAnalyses, peerRankings);
          eventBus.emit({ type: "COUNCIL_MEMBER_RESPONSE", councilSessionId, account: council_config.chairman, stage: "synthesis", content: synthesis.recommendedApproach ?? "", role: "chairman" });
          eventBus.emit({ type: "COUNCIL_STAGE_COMPLETE", councilSessionId, stage: "synthesis", results: synthesis });

          analysis = { taskGoal: msg.goal, timestamp: new Date().toISOString(), individualAnalyses, peerRankings, aggregateRankings, synthesis };
          eventBus.emit({ type: "COUNCIL_SESSION_END", councilSessionId, verdict: synthesis.recommendedApproach, confidence: synthesis.confidence });
        } else {
          analysis = await council.analyze(msg.goal, msg.context);
        }

        try { const { appendCouncilAnalysis } = await import("../../services/council-store"); await appendCouncilAnalysis(analysis); } catch (err: any) { console.error("[council] persist failed:", err.message); }
        safeWrite(socket, reply(msg, { type: "result", analysis }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    council_discussion: async (socket: Socket, msg: any) => {
      if (guardCouncil(ctx, socket, msg) === false) return;
      if (guardField(ctx, socket, msg, "goal") === false) return;
      try {
        const { fullConfig, council_config } = await getCouncilConfig(ctx);
        if (!council_config) { safeWrite(socket, reply(msg, { type: "error", error: "Council not configured" })); return; }
        const { runCouncilDiscussion } = await import("../../services/council-discussion");
        const eventBus = ctx.state.eventBus;
        const councilSessionId = crypto.randomUUID();

        eventBus.emit({ type: "COUNCIL_SESSION_START", councilSessionId, goal: msg.goal, stage: "research", members: council_config.members });

        const result = await runCouncilDiscussion(
          {
            accounts: fullConfig.accounts, members: council_config.members, chairman: council_config.chairman,
            goal: msg.goal, context: msg.context, maxRounds: msg.maxRounds ?? 2,
            researchTimeoutMs: msg.researchTimeoutMs ?? 180_000, discussionTimeoutMs: msg.discussionTimeoutMs ?? 90_000, decisionTimeoutMs: msg.decisionTimeoutMs ?? 180_000,
          },
          (event: any) => {
            if (event.type === "member_done") {
              eventBus.emit({ type: "COUNCIL_MEMBER_RESPONSE", councilSessionId, account: event.account, stage: event.phase, content: event.content, role: event.account === council_config!.chairman ? "chairman" : "member" });
            } else if (event.type === "phase_start") {
              eventBus.emit({ type: "COUNCIL_STAGE_START", councilSessionId, stage: event.phase });
            } else if (event.type === "phase_complete") {
              eventBus.emit({ type: "COUNCIL_STAGE_COMPLETE", councilSessionId, stage: event.phase, results: {} });
            } else if (event.type === "member_chunk") {
              eventBus.emit({ type: "AGENT_STREAM_CHUNK", sessionId: councilSessionId, account: event.account, chunkType: event.chunkType, content: event.content });
            }
          },
        );

        eventBus.emit({ type: "COUNCIL_SESSION_END", councilSessionId, verdict: result.decision?.content ?? "", confidence: 0 });
        safeWrite(socket, reply(msg, { type: "result", discussion: result }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    council_verify: async (socket: Socket, msg: any) => {
      if (guardCouncil(ctx, socket, msg) === false) return;
      if (guardField(ctx, socket, msg, "taskId") === false) return;
      if (guardField(ctx, socket, msg, "goal") === false) return;
      if (guardField(ctx, socket, msg, "acceptance_criteria", "array") === false) return;
      try {
        const { verifyTaskCompletion } = await import("../../services/verification-council");
        const { createAccountCaller } = await import("../../services/council");
        const { fullConfig, council_config } = await getCouncilConfig(ctx);
        if (!council_config) { safeWrite(socket, reply(msg, { type: "error", error: "Council not configured" })); return; }
        const timeoutMs = msg.timeoutMs ?? council_config.timeoutMs;

        let llmCaller;
        if (features?.streaming) {
          const { createStreamingAccountCaller } = await import("../../services/council-framework");
          llmCaller = createStreamingAccountCaller(fullConfig.accounts, ctx.state.eventBus, timeoutMs);
        } else {
          llmCaller = createAccountCaller(fullConfig.accounts, timeoutMs);
        }

        const result = await verifyTaskCompletion(msg.taskId,
          { diff: msg.diff, testResults: msg.testResults, filesChanged: msg.filesChanged, riskNotes: msg.riskNotes },
          { goal: msg.goal, acceptance_criteria: msg.acceptance_criteria },
          { members: council_config.members, chairman: council_config.chairman, llmCaller },
        );

        try { const { appendVerificationResult } = await import("../../services/council-store"); await appendVerificationResult(result); } catch (err: any) { console.error("[council] verify persist failed:", err.message); }
        safeWrite(socket, reply(msg, { type: "result", ...result }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },

    council_history: async (socket: Socket, msg: any) => {
      if (guardCouncil(ctx, socket, msg) === false) return;
      try {
        const { loadCouncilCache, loadVerificationCache } = await import("../../services/council-store");
        const analyses = await loadCouncilCache();
        const verifications = await loadVerificationCache();
        safeWrite(socket, reply(msg, { type: "result", ...analyses, ...verifications }));
      } catch (err: any) {
        safeWrite(socket, reply(msg, { type: "error", error: err.message }));
      }
    },
  };
}
