
import { createSimpleContext } from "./helper.js";

export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext({
  name: "PromptStash",
  init: () => {
    const stashes = new Map<string, string>();
    let currentSessionId: string | null = null;

    return {
      setSession(sessionId: string) {
        currentSessionId = sessionId;
      },

      stash(text: string) {
        if (!currentSessionId) return;
        if (text.trim()) {
          stashes.set(currentSessionId, text);
        } else {
          stashes.delete(currentSessionId);
        }
      },

      pop(): string | null {
        if (!currentSessionId) return null;
        const text = stashes.get(currentSessionId) ?? null;
        if (text !== null) stashes.delete(currentSessionId);
        return text;
      },

      peek(): string | null {
        if (!currentSessionId) return null;
        return stashes.get(currentSessionId) ?? null;
      },
    };
  },
});
