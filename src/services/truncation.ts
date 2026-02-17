
import { getHubDir } from "../paths.js";

export const MAX_LINES = 2000;
export const MAX_BYTES = 50 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type TruncationResult =
  | { content: string; truncated: false }
  | { content: string; truncated: true; spillPath: string };

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
  direction?: "head" | "tail";
}

export function getSpillDir(): string {
  return `${getHubDir()}/tool-output`;
}

export async function truncateOutput(
  text: string,
  opts: TruncationOptions = {},
): Promise<TruncationResult> {
  const maxLines = opts.maxLines ?? MAX_LINES;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const direction = opts.direction ?? "head";
  const lines = text.split("\n");
  const totalBytes = Buffer.byteLength(text, "utf-8");

  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false };
  }

  const out: string[] = [];
  let bytes = 0;
  let hitBytes = false;

  if (direction === "head") {
    for (let i = 0; i < lines.length && i < maxLines; i++) {
      const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        hitBytes = true;
        break;
      }
      out.push(lines[i]);
      bytes += size;
    }
  } else {
    for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0);
      if (bytes + size > maxBytes) {
        hitBytes = true;
        break;
      }
      out.unshift(lines[i]);
      bytes += size;
    }
  }

  const removed = hitBytes ? totalBytes - bytes : lines.length - out.length;
  const unit = hitBytes ? "bytes" : "lines";
  const preview = out.join("\n");

  const spillDir = getSpillDir();
  await Bun.spawn(["mkdir", "-p", spillDir]).exited;
  const timestamp = Date.now();
  const spillPath = `${spillDir}/tool_${timestamp}.txt`;
  await Bun.write(spillPath, text);

  const hint = `The tool call succeeded but the output was truncated. Full output saved to: ${spillPath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`;

  const message = direction === "head"
    ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
    : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`;

  return { content: message, truncated: true, spillPath };
}

export async function cleanupSpillFiles(maxAgeDays = 7): Promise<number> {
  const spillDir = getSpillDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  try {
    const glob = new Bun.Glob("tool_*.txt");
    const entries: string[] = [];
    for await (const entry of glob.scan({ cwd: spillDir, onlyFiles: true })) {
      entries.push(entry);
    }

    for (const entry of entries) {

      const match = entry.match(/^tool_(\d+)\.txt$/);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
      if (ts >= cutoff) continue;

      const { unlink } = await import("node:fs/promises");
      await unlink(`${spillDir}/${entry}`).catch(() => {});
      cleaned++;
    }
  } catch {

  }

  return cleaned;
}
