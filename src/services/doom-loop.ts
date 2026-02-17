
export const DOOM_LOOP_THRESHOLD = 3;

export interface ToolCallRecord {
  name: string;
  input: string;
}

export class DoomLoopDetector {
  private history: ToolCallRecord[] = [];
  private readonly threshold: number;
  private triggered = false;

  constructor(threshold?: number) {
    this.threshold = threshold ?? DOOM_LOOP_THRESHOLD;
  }

  record(call: ToolCallRecord): boolean {
    this.history.push(call);

    if (this.history.length > this.threshold) {
      this.history = this.history.slice(-this.threshold);
    }

    if (this.history.length < this.threshold) return false;

    const lastN = this.history.slice(-this.threshold);
    const first = lastN[0];
    const allIdentical = lastN.every(
      (c) => c.name === first.name && c.input === first.input,
    );

    if (allIdentical) {
      this.triggered = true;
    }
    return allIdentical;
  }

  wasTriggered(): boolean {
    return this.triggered;
  }

  getRepeatedCall(): ToolCallRecord | undefined {
    if (!this.triggered || this.history.length === 0) return undefined;
    return this.history[this.history.length - 1];
  }

  formatMessage(): string {
    const call = this.getRepeatedCall();
    if (!call) return "Doom loop detected: agent is stuck in a repeated tool call cycle";
    const inputPreview = call.input.length > 100 ? call.input.slice(0, 100) + "..." : call.input;
    return (
      `Doom loop detected: tool "${call.name}" called ${this.threshold} times ` +
      `with identical input: ${inputPreview}`
    );
  }

  reset(): void {
    this.history = [];
    this.triggered = false;
  }

  get count(): number {
    return this.history.length;
  }
}

export function normalizeToolInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (input === null || input === undefined) return "";
  try {
    return JSON.stringify(input, Object.keys(input as object).sort());
  } catch {
    return String(input);
  }
}
