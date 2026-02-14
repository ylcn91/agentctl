import type { CouncilResponse, CouncilRanking, AggregateRank, AccountConfig } from "../types";
import { DEFAULT_COUNCIL_CONFIG } from "./council-config";
import type { CouncilServiceConfig } from "./council-config";

export { type CouncilServiceConfig as CouncilConfig };

export interface CouncilAnalysis {
  taskGoal: string;
  timestamp: string;
  individualAnalyses: CouncilResponse[];
  peerRankings: CouncilRanking[];
  aggregateRankings: AggregateRank[];
  synthesis: {
    chairman: string;
    consensusComplexity: "low" | "medium" | "high" | "critical";
    consensusDurationMinutes: number;
    consensusSkills: string[];
    recommendedApproach: string;
    recommendedProvider?: string;
    confidence: number;
    dissenting_views?: string[];
  };
}

export type LLMCaller = (account: string, systemPrompt: string, userPrompt: string) => Promise<string>;

export function parseJSONFromLLM(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown fenced blocks
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

interface ProviderCommand {
  cmd: string[];
  env: Record<string, string>;
  parseOutput: (stdout: string) => string;
}

export function buildProviderCommand(account: AccountConfig, prompt: string): ProviderCommand {
  const baseEnv: Record<string, string> = {};

  switch (account.provider) {
    case "claude-code":
      return {
        cmd: ["claude", "-p", "--output-format", "json"],
        env: { ...baseEnv, CLAUDE_CONFIG_DIR: account.configDir },
        parseOutput: (stdout: string) => {
          try {
            const json = JSON.parse(stdout);
            return json.result ?? stdout;
          } catch {
            return stdout;
          }
        },
      };
    case "codex-cli":
      return {
        cmd: ["codex", "-q"],
        env: { ...baseEnv, CODEX_HOME: account.configDir },
        parseOutput: (stdout: string) => stdout,
      };
    case "opencode":
      return {
        cmd: ["opencode", "run"],
        env: baseEnv,
        parseOutput: (stdout: string) => stdout,
      };
    case "cursor-agent":
      return {
        cmd: ["agent"],
        env: baseEnv,
        parseOutput: (stdout: string) => stdout,
      };
    case "gemini-cli":
      return {
        cmd: ["gemini"],
        env: baseEnv,
        parseOutput: (stdout: string) => stdout,
      };
    case "openhands":
      return {
        cmd: ["openhands"],
        env: baseEnv,
        parseOutput: (stdout: string) => stdout,
      };
    default:
      throw new Error(`Unsupported provider: ${account.provider}`);
  }
}

export function createAccountCaller(accounts: AccountConfig[]): LLMCaller {
  const accountMap = new Map<string, AccountConfig>();
  for (const acc of accounts) {
    accountMap.set(acc.name, acc);
  }

  return async (accountName: string, systemPrompt: string, userPrompt: string): Promise<string> => {
    const account = accountMap.get(accountName);
    if (!account) {
      throw new Error(`Account not found: ${accountName}`);
    }

    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    const { cmd, env, parseOutput } = buildProviderCommand(account, prompt);

    const proc = Bun.spawn(cmd, {
      stdin: new Response(prompt).body,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...env },
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Account ${accountName} CLI exited with code ${exitCode}: ${stderr.slice(0, 500)}`);
    }

    return parseOutput(stdout.trim());
  };
}

/**
 * Calculate aggregate rankings from peer review results.
 * Each ranking is an array of 0-based indices (best-to-worst).
 * Returns accounts sorted by average rank (lower is better).
 */
export function calculateAggregateRankings(
  rankings: CouncilRanking[],
  accounts: string[],
): AggregateRank[] {
  const positionSums = new Map<string, { total: number; count: number }>();

  for (const r of rankings) {
    for (let position = 0; position < r.ranking.length; position++) {
      const accountIndex = r.ranking[position];
      if (accountIndex < 0 || accountIndex >= accounts.length) continue;
      const account = accounts[accountIndex];
      const entry = positionSums.get(account) ?? { total: 0, count: 0 };
      entry.total += position + 1; // 1-based rank
      entry.count += 1;
      positionSums.set(account, entry);
    }
  }

  const aggregate: AggregateRank[] = [];
  for (const [account, { total, count }] of positionSums) {
    aggregate.push({
      account,
      averageRank: Math.round((total / count) * 100) / 100,
      rankCount: count,
    });
  }

  aggregate.sort((a, b) => a.averageRank - b.averageRank);
  return aggregate;
}

const STAGE1_SYSTEM_PROMPT = `You are a task analysis expert. Analyze the given task and respond with a JSON object containing:
- complexity: "low" | "medium" | "high" | "critical"
- estimatedDurationMinutes: number
- requiredSkills: string[]
- recommendedApproach: string (brief description)
- risks: string[]
- suggestedProvider: string (optional, one of: "claude-code", "codex-cli", "openhands", "gemini-cli")

Respond ONLY with valid JSON, no other text.`;

const STAGE2_SYSTEM_PROMPT = `You are a peer reviewer evaluating task analyses. You will be given multiple anonymized analyses (labeled Analysis A, Analysis B, etc.). Rank them from best to worst and explain your reasoning.

Respond with a JSON object containing:
- ranking: number[] (indices 0-based, sorted best-to-worst)
- reasoning: string

Respond ONLY with valid JSON, no other text.`;

const STAGE3_SYSTEM_PROMPT = `You are the chairman of an analysis council. You will receive individual task analyses and peer rankings. Synthesize them into a final recommendation.

Respond with a JSON object containing:
- consensusComplexity: "low" | "medium" | "high" | "critical"
- consensusDurationMinutes: number
- consensusSkills: string[]
- recommendedApproach: string
- recommendedProvider: string (optional, one of: "claude-code", "codex-cli", "openhands", "gemini-cli")
- confidence: number (0-1, how confident the council is)
- dissenting_views: string[] (optional, any notable disagreements)

Respond ONLY with valid JSON, no other text.`;

export class CouncilService {
  private config: CouncilServiceConfig;
  private callLLM: LLMCaller;

  constructor(config: Partial<CouncilServiceConfig> & Pick<CouncilServiceConfig, "members" | "chairman">, llmCaller?: LLMCaller) {
    this.config = { ...DEFAULT_COUNCIL_CONFIG, ...config };

    if (llmCaller) {
      this.callLLM = llmCaller;
    } else {
      throw new Error("Council requires an LLM caller (use createAccountCaller with registered accounts)");
    }
  }

  async analyze(goal: string, context?: string): Promise<CouncilAnalysis> {
    const individualAnalyses = await this.stage1_collectAnalyses(goal, context);

    if (individualAnalyses.length === 0) {
      return {
        taskGoal: goal,
        timestamp: new Date().toISOString(),
        individualAnalyses: [],
        peerRankings: [],
        aggregateRankings: [],
        synthesis: {
          chairman: this.config.chairman,
          consensusComplexity: "medium",
          consensusDurationMinutes: 30,
          consensusSkills: [],
          recommendedApproach: "Unable to analyze — all accounts failed",
          confidence: 0,
        },
      };
    }

    const peerRankings = await this.stage2_peerReview(goal, individualAnalyses);
    const aggregateRankings = calculateAggregateRankings(
      peerRankings,
      individualAnalyses.map((a) => a.account),
    );
    const synthesis = await this.stage3_synthesize(goal, individualAnalyses, peerRankings);

    return {
      taskGoal: goal,
      timestamp: new Date().toISOString(),
      individualAnalyses,
      peerRankings,
      aggregateRankings,
      synthesis,
    };
  }

  async stage1_collectAnalyses(goal: string, context?: string): Promise<CouncilResponse[]> {
    const userPrompt = context
      ? `Task: ${goal}\n\nAdditional context: ${context}`
      : `Task: ${goal}`;

    const results = await Promise.allSettled(
      this.config.members.map(async (account) => {
        const response = await this.callLLM(account, STAGE1_SYSTEM_PROMPT, userPrompt);
        const parsed = parseJSONFromLLM(response);
        if (!parsed) {
          throw new Error(`Failed to parse response from ${account}`);
        }
        return {
          account,
          complexity: parsed.complexity ?? "medium",
          estimatedDurationMinutes: parsed.estimatedDurationMinutes ?? 30,
          requiredSkills: parsed.requiredSkills ?? [],
          recommendedApproach: parsed.recommendedApproach ?? "",
          risks: parsed.risks ?? [],
          suggestedProvider: parsed.suggestedProvider,
        } as CouncilResponse;
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<CouncilResponse> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  async stage2_peerReview(goal: string, analyses: CouncilResponse[]): Promise<CouncilRanking[]> {
    const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const anonymized = analyses.map((a, i) => {
      return `Analysis ${labels[i]}:\n- Complexity: ${a.complexity}\n- Estimated Duration: ${a.estimatedDurationMinutes} minutes\n- Required Skills: ${a.requiredSkills.join(", ")}\n- Approach: ${a.recommendedApproach}\n- Risks: ${a.risks.join(", ")}`;
    }).join("\n\n");

    const userPrompt = `Task: ${goal}\n\nHere are the analyses to review:\n\n${anonymized}`;

    const results = await Promise.allSettled(
      this.config.members.map(async (account) => {
        const response = await this.callLLM(account, STAGE2_SYSTEM_PROMPT, userPrompt);
        const parsed = parseJSONFromLLM(response);
        if (!parsed) {
          throw new Error(`Failed to parse peer review from ${account}`);
        }
        return {
          reviewer: account,
          ranking: parsed.ranking ?? [],
          reasoning: parsed.reasoning ?? "",
        } as CouncilRanking;
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<CouncilRanking> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  async stage3_synthesize(
    goal: string,
    analyses: CouncilResponse[],
    rankings: CouncilRanking[]
  ): Promise<CouncilAnalysis["synthesis"]> {
    const analysesText = analyses.map((a, i) => {
      return `Analysis ${i + 1} (${a.account}):\n- Complexity: ${a.complexity}\n- Duration: ${a.estimatedDurationMinutes}min\n- Skills: ${a.requiredSkills.join(", ")}\n- Approach: ${a.recommendedApproach}\n- Risks: ${a.risks.join(", ")}\n- Suggested Provider: ${a.suggestedProvider ?? "none"}`;
    }).join("\n\n");

    const rankingsText = rankings.map((r) => {
      return `Reviewer ${r.reviewer}: Ranking [${r.ranking.join(", ")}] — ${r.reasoning}`;
    }).join("\n");

    const userPrompt = `Task: ${goal}\n\nIndividual Analyses:\n${analysesText}\n\nPeer Rankings:\n${rankingsText}`;

    const response = await this.callLLM(this.config.chairman, STAGE3_SYSTEM_PROMPT, userPrompt);
    const parsed = parseJSONFromLLM(response);
    if (!parsed) {
      throw new Error("Failed to parse chairman synthesis");
    }

    return {
      chairman: this.config.chairman,
      consensusComplexity: parsed.consensusComplexity ?? "medium",
      consensusDurationMinutes: parsed.consensusDurationMinutes ?? 30,
      consensusSkills: parsed.consensusSkills ?? [],
      recommendedApproach: parsed.recommendedApproach ?? "",
      recommendedProvider: parsed.recommendedProvider,
      confidence: parsed.confidence ?? 0.5,
      dissenting_views: parsed.dissenting_views,
    };
  }
}
