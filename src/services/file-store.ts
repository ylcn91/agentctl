import { join, dirname } from "path";
import { existsSync, statSync } from "fs";
import { mkdir, rename, writeFile, unlink, readdir, copyFile, rmdir, stat } from "node:fs/promises";

interface Lock {
  release(): Promise<void>;
}

interface LockOptions {
  retries?: number;
  backoffMs?: number;
  ttlMs?: number;
}

const DEFAULT_LOCK_OPTS: Required<LockOptions> = {
  retries: 20,
  backoffMs: 50,
  ttlMs: 10_000,
};

export type { Lock as LockHandle, LockOptions };

export async function acquireLock(
  lockPath: string,
  opts: LockOptions = {}
): Promise<Lock> {
  const { retries, backoffMs, ttlMs } = { ...DEFAULT_LOCK_OPTS, ...opts };

  await mkdir(dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    try {
      const s = statSync(lockPath);
      if (s.isFile()) {
        const ageMs = Date.now() - s.mtimeMs;
        if (ageMs > ttlMs) {
          try { await unlink(lockPath); } catch {  }
        }
      }
    } catch {  }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await mkdir(lockPath, { recursive: false });

      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          try { await rmdir(lockPath); } catch {  }
        },
      };
    } catch (err: any) {
      if (err.code !== "EEXIST") throw err;

      try {
        const lockStat = await stat(lockPath);
        const ageMs = Date.now() - lockStat.mtimeMs;
        if (ageMs > ttlMs) {
          try { await rmdir(lockPath); } catch {  }
          continue;
        }
      } catch {
        continue;
      }

      if (attempt < retries) {
        const delay = backoffMs + Math.random() * backoffMs;
        await Bun.sleep(delay);
      }
    }
  }

  throw new Error(`Failed to acquire lock after ${retries} retries: ${lockPath}`);
}

export async function atomicWrite(path: string, data: object): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const lockPath = `${path}.lock`;
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  const lock = await acquireLock(lockPath);

  try {
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, path);
  } finally {
    try { await unlink(tmpPath); } catch {  }
    await lock.release();
  }
}

export async function atomicRead<T = unknown>(path: string): Promise<T | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return await file.json() as T;
  } catch {
    return null;
  }
}

export async function backupFile(path: string, version: number): Promise<string> {
  const backupPath = `${path}.backup.v${version}.${Date.now()}`;
  await copyFile(path, backupPath);
  return backupPath;
}

export async function cleanTempFiles(dir: string): Promise<number> {
  let cleaned = 0;
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.includes(".tmp.")) {
        await unlink(join(dir, entry)).catch(() => {});
        cleaned++;
      }
    }
  } catch {  }
  return cleaned;
}
