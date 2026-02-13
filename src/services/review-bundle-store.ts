import { join } from "node:path";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { atomicRead, atomicWrite } from "./file-store";
import { HUB_DIR } from "../types";
import type { ReviewBundle } from "./review-bundle";

function getBundlesDir(): string {
  const base = process.env.CLAUDE_HUB_DIR ?? HUB_DIR;
  return join(base, "review-bundles");
}

export async function saveBundle(bundle: ReviewBundle): Promise<void> {
  const dir = getBundlesDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${bundle.taskId}.json`);
  await atomicWrite(filePath, bundle);
}

export async function getBundle(taskId: string): Promise<ReviewBundle | null> {
  const filePath = join(getBundlesDir(), `${taskId}.json`);
  return atomicRead<ReviewBundle>(filePath);
}

export function deleteBundle(taskId: string): boolean {
  const filePath = join(getBundlesDir(), `${taskId}.json`);
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function listBundles(): string[] {
  const dir = getBundlesDir();
  try {
    const entries = readdirSync(dir);
    return entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => e.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
