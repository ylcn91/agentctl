
import { createSimpleContext } from "./helper.js";
import { useKV } from "./kv.js";

interface FrecencyEntry {
  count: number;
  lastAccess: number;
}

const HALF_LIFE_MS = 24 * 60 * 60 * 1000;

const MAX_ENTRIES = 500;

const KV_KEY = "frecency_scores";

function decayFactor(lastAccess: number, now: number): number {
  const elapsed = now - lastAccess;
  if (elapsed <= 0) return 1;
  return Math.pow(0.5, elapsed / HALF_LIFE_MS);
}

function computeScore(entry: FrecencyEntry, now: number): number {
  return entry.count * decayFactor(entry.lastAccess, now);
}

export const { use: useFrecency, provider: FrecencyProvider } = createSimpleContext({
  name: "Frecency",
  init: () => {
    const kv = useKV();

    function getEntries(): Record<string, FrecencyEntry> {
      return (kv.get(KV_KEY) as Record<string, FrecencyEntry>) ?? {};
    }

    function saveEntries(entries: Record<string, FrecencyEntry>) {
      kv.set(KV_KEY, entries);
    }

    function pruneIfNeeded(entries: Record<string, FrecencyEntry>): Record<string, FrecencyEntry> {
      const keys = Object.keys(entries);
      if (keys.length <= MAX_ENTRIES) return entries;

      const now = Date.now();
      const sorted = keys
        .map((k) => ({ key: k, score: computeScore(entries[k], now) }))
        .sort((a, b) => b.score - a.score);

      const pruned: Record<string, FrecencyEntry> = {};
      for (let i = 0; i < MAX_ENTRIES; i++) {
        pruned[sorted[i].key] = entries[sorted[i].key];
      }
      return pruned;
    }

    return {
      score(path: string): number {
        const entries = getEntries();
        const entry = entries[path];
        if (!entry) return 0;
        return computeScore(entry, Date.now());
      },

      record(path: string) {
        const entries = getEntries();
        const existing = entries[path];
        const now = Date.now();
        entries[path] = {
          count: (existing?.count ?? 0) + 1,
          lastAccess: now,
        };
        saveEntries(pruneIfNeeded(entries));
      },

      topFiles(query: string, limit = 10): string[] {
        const entries = getEntries();
        const now = Date.now();
        const lowerQuery = query.toLowerCase();

        return Object.keys(entries)
          .filter((path) => path.toLowerCase().includes(lowerQuery))
          .map((path) => ({ path, score: computeScore(entries[path], now) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((item) => item.path);
      },
    };
  },
});
