/**
 * NDJSON line parser - buffers incoming data and emits complete JSON messages.
 * Handles TCP chunking: partial messages, concatenated messages, etc.
 */
export function createLineParser(onMessage: (msg: any) => void): { feed(chunk: Buffer | string): void } {
  let buffer = "";
  return {
    feed(chunk: Buffer | string) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // last element is incomplete (or empty)
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          onMessage(JSON.parse(trimmed));
        } catch {
          // skip invalid JSON lines
        }
      }
    }
  };
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function frameSend(msg: object): string {
  return JSON.stringify(msg) + "\n";
}
