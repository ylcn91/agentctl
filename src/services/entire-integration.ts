import { $ } from "bun";

export interface CheckpointListEntry {
  checkpointId: string;
  sessionId: string;
  createdAt: string;
  message: string;
}

export interface CheckpointMetadata {
  checkpointId: string;
  sessionId: string;
  strategy: string;
  branch: string;
  filesTouched: string[];
  checkpointsCount: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    apiCallCount: number;
  };
  sessions?: Array<{
    metadata: string;
    transcript: string;
  }>;
}

export interface TranscriptLine {
  raw: string;
  parsed: Record<string, unknown> | null;
}

export async function listCheckpoints(repoPath: string): Promise<CheckpointListEntry[]> {
  const DELIMITER = "---CHECKPOINT_DELIM---";
  try {
    const logResult = await $`git log entire/checkpoints/v1 --format=%s${DELIMITER}%aI${DELIMITER}`.cwd(repoPath).quiet();
    const stdout = logResult.stdout.toString().trim();
    if (!stdout) return [];

    const records = stdout.split(DELIMITER + "\n").filter(Boolean);

    const entries: CheckpointListEntry[] = [];
    for (const record of records) {
      const parts = record.split(DELIMITER);
      const subject = parts[0]?.trim();
      const date = parts[1]?.trim();

      if (!subject) continue;

      const match = subject.match(/^Checkpoint:\s+(\w+)/);
      if (match) {
        const checkpointId = match[1];
        entries.push({
          checkpointId,
          sessionId: "",
          createdAt: date ?? "",
          message: subject,
        });
      }
    }

    return entries;
  } catch (err) {

    const message = err instanceof Error ? err.message : String(err);
    const isExpected =
      message.includes("unknown revision") ||
      message.includes("bad default revision") ||
      message.includes("exit code 128");
    if (!isExpected) {
      console.error("[listCheckpoints]", message);
    }
    return [];
  }
}

export async function readCheckpoint(
  repoPath: string,
  checkpointId: string,
): Promise<{ metadata: CheckpointMetadata | null; transcript: TranscriptLine[] }> {

  if (!checkpointId || checkpointId.length < 3) {
    return { metadata: null, transcript: [] };
  }

  const prefix = checkpointId.slice(0, 2);
  const suffix = checkpointId.slice(2);
  const basePath = `${prefix}/${suffix}`;

  let metadata: CheckpointMetadata | null = null;
  try {
    const metaResult = await $`git show entire/checkpoints/v1:${basePath}/metadata.json`.cwd(repoPath).quiet();
    const raw = JSON.parse(metaResult.stdout.toString());
    if (typeof raw === "object" && raw !== null) {
      metadata = {
        checkpointId: raw.checkpoint_id ?? checkpointId,
        sessionId: raw.session_id ?? "",
        strategy: raw.strategy ?? "",
        branch: raw.branch ?? "",
        filesTouched: Array.isArray(raw.files_touched) ? raw.files_touched : [],
        checkpointsCount: raw.checkpoints_count ?? 0,
        tokenUsage: raw.token_usage ? {
          inputTokens: raw.token_usage.input_tokens ?? 0,
          outputTokens: raw.token_usage.output_tokens ?? 0,
          apiCallCount: raw.token_usage.api_call_count ?? 0,
        } : undefined,
        sessions: Array.isArray(raw.sessions) ? raw.sessions : undefined,
      };
    }
  } catch {

  }

  const transcript: TranscriptLine[] = [];
  try {
    const jsonlResult = await $`git show entire/checkpoints/v1:${basePath}/0/full.jsonl`.cwd(repoPath).quiet();
    const lines = jsonlResult.stdout.toString().trim().split("\n").filter(Boolean);
    for (const line of lines) {
      let parsed: Record<string, unknown> | null = null;
      try {
        const obj = JSON.parse(line);

        if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
          parsed = obj as Record<string, unknown>;
        }
      } catch {  }
      transcript.push({ raw: line, parsed });
    }
  } catch {

  }

  return { metadata, transcript };
}
