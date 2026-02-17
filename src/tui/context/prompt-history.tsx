
import { createSimpleContext } from "./helper.js";
import { useKV } from "./kv.js";

const KV_KEY = "prompt_history";
const MAX_ENTRIES = 100;

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const kv = useKV();

    let cursor = -1;

    function getEntries(): string[] {
      return (kv.get(KV_KEY) as string[]) ?? [];
    }

    function saveEntries(entries: string[]) {
      kv.set(KV_KEY, entries);
    }

    function filtered(prefix?: string): string[] {
      const entries = getEntries();
      if (!prefix) return entries;
      const lower = prefix.toLowerCase();
      return entries.filter((e) => e.toLowerCase().startsWith(lower));
    }

    return {
      add(text: string) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const entries = getEntries();
        if (entries.length > 0 && entries[0] === trimmed) {
          cursor = -1;
          return;
        }
        const deduped = entries.filter((e) => e !== trimmed);
        deduped.unshift(trimmed);
        if (deduped.length > MAX_ENTRIES) deduped.length = MAX_ENTRIES;
        saveEntries(deduped);
        cursor = -1;
      },

      prev(prefix?: string): string | null {
        const entries = filtered(prefix);
        if (entries.length === 0) return null;
        cursor = Math.min(cursor + 1, entries.length - 1);
        return entries[cursor] ?? null;
      },

      next(prefix?: string): string | null {
        if (cursor <= 0) {
          cursor = -1;
          return null;
        }
        const entries = filtered(prefix);
        cursor = cursor - 1;
        return entries[cursor] ?? null;
      },

      current(): string | null {
        if (cursor < 0) return null;
        const entries = getEntries();
        return entries[cursor] ?? null;
      },

      reset() {
        cursor = -1;
      },
    };
  },
});
