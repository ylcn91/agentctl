
import type { AccountConfig } from "../types";
import { throwIfAborted } from "./errors";

export type LLMCaller = (account: string, systemPrompt: string, userPrompt: string, signal?: AbortSignal) => Promise<string>;

export type StreamingLLMCaller = (
  account: string,
  systemPrompt: string,
  userPrompt: string,
  onChunk?: (chunk: import("./stream-normalizer").NormalizedChunk) => void,
  signal?: AbortSignal,
) => Promise<string>;

export interface CouncilServiceConfig {
  members: string[];
  chairman: string;
  timeoutMs?: number;
}

export const DEFAULT_COUNCIL_CONFIG: CouncilServiceConfig = {
  members: [],
  chairman: "",
  timeoutMs: 120_000,
};

export function parseJSONFromLLM(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
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

export interface ProviderCommand {
  cmd: string[];
  env: Record<string, string>;
  parseOutput: (stdout: string) => string;
  stdinInput: boolean;
}

export function expandHome(p: string): string {
  return p.startsWith("~/") ? p.replace("~", process.env.HOME ?? "") : p;
}

const DEFAULT_CLAUDE_CONFIG_DIR = `${process.env.HOME ?? ""}/.claude`;

export function buildProviderCommand(account: AccountConfig, prompt: string, opts?: { streaming?: boolean; model?: string }): ProviderCommand {
  const baseEnv: Record<string, string> = {};
  const configDir = expandHome(account.configDir);
  const streaming = opts?.streaming ?? false;
  const model = opts?.model;

  switch (account.provider) {
    case "claude-code": {
      const claudeEnv = configDir === DEFAULT_CLAUDE_CONFIG_DIR
        ? baseEnv
        : { ...baseEnv, CLAUDE_CONFIG_DIR: configDir };
      const cmd = streaming
        ? ["claude", "-p", "--output-format", "stream-json", "--verbose"]
        : ["claude", "-p", "--output-format", "json"];
      if (model) cmd.push("--model", model);
      return {
        cmd,
        env: claudeEnv,
        stdinInput: true,
        parseOutput: (stdout: string) => {
          try {
            const json = JSON.parse(stdout);
            return json.result ?? stdout;
          } catch {
            return stdout;
          }
        },
      };
    }
    case "codex-cli": {
      const cmd = ["codex", "exec"];
      if (model) cmd.push("--model", model);
      return {
        cmd,
        env: { ...baseEnv, CODEX_HOME: configDir },
        stdinInput: true,
        parseOutput: (stdout: string) => stdout,
      };
    }
    case "opencode": {
      const baseCmd = streaming
        ? ["opencode", "run", "--format", "json", "--thinking"]
        : ["opencode", "run"];
      if (model) baseCmd.push("--model", model);
      return {
        cmd: [...baseCmd, "--", prompt],
        env: baseEnv,
        stdinInput: false,
        parseOutput: (stdout: string) => stdout,
      };
    }
    case "cursor-agent": {
      const cmd = streaming
        ? ["agent", "-p", "--output-format", "stream-json"]
        : ["agent", "-p", "--output-format", "json"];
      if (model) cmd.push("--model", model);
      return {
        cmd,
        env: baseEnv,
        stdinInput: true,
        parseOutput: (stdout: string) => stdout,
      };
    }
    case "gemini-cli": {
      const cmd = ["gemini"];
      if (model) cmd.push("--model", model);
      return {
        cmd,
        env: baseEnv,
        stdinInput: true,
        parseOutput: (stdout: string) => stdout,
      };
    }
    case "openhands": {
      const cmd = ["openhands"];
      if (model) cmd.push("--model", model);
      return {
        cmd,
        env: baseEnv,
        stdinInput: true,
        parseOutput: (stdout: string) => stdout,
      };
    }
    default:
      throw new Error(`Unsupported provider: ${account.provider}`);
  }
}

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export async function collectFromAccounts<T>(
  accounts: string[],
  fn: (account: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T[]> {
  throwIfAborted(signal);
  const results = await Promise.allSettled(accounts.map(fn));
  const fulfilled: T[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") fulfilled.push(r.value);
  }
  return fulfilled;
}

export function anonymizeForPeerReview(
  items: { fields: Record<string, string | string[]> }[],
  labelPrefix: string,
): string {
  return items
    .map((item, i) => {
      const lines = Object.entries(item.fields).map(([key, value]) => {
        const formatted = Array.isArray(value) ? value.join(", ") || "none" : value;
        return `- ${key}: ${formatted}`;
      });
      return `${labelPrefix} ${LABELS[i]}:\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export {
  createAccountCaller,
  createStreamingAccountCaller,
  LLMTimeoutError,
  DEFAULT_TIMEOUT_MS,
} from "./council-llm-callers";

export {
  runCouncilDirect,
  runCouncilDiscussionDirect,
  type CouncilDirectEvent,
  type DirectCouncilOpts,
  type DirectDiscussionOpts,
} from "./council-direct";
