export interface ProgressReport {
  taskId: string;
  agent: string;
  percent: number;
  currentStep: string;
  blockers?: string[];
  estimatedRemainingMinutes?: number;
  artifactsProduced?: string[];
  timestamp: string;
}

const MAX_REPORTS_PER_TASK = 100;

export class ProgressTracker {
  private reports: Map<string, ProgressReport[]> = new Map();

  report(input: Omit<ProgressReport, "timestamp">): ProgressReport {
    const report: ProgressReport = {
      ...input,
      timestamp: new Date().toISOString(),
    };

    let history = this.reports.get(input.taskId);
    if (!history) {
      history = [];
      this.reports.set(input.taskId, history);
    }

    history.push(report);

    if (history.length > MAX_REPORTS_PER_TASK) {
      history.splice(0, history.length - MAX_REPORTS_PER_TASK);
    }

    return report;
  }

  getLatest(taskId: string): ProgressReport | null {
    const history = this.reports.get(taskId);
    if (!history || history.length === 0) return null;
    return history[history.length - 1];
  }

  getHistory(taskId: string): ProgressReport[] {
    return this.reports.get(taskId) ?? [];
  }

  getActiveTasks(): string[] {
    return Array.from(this.reports.keys());
  }

  isStalled(taskId: string, thresholdMinutes: number): boolean {
    const latest = this.getLatest(taskId);
    if (!latest) return false;

    const elapsed = Date.now() - new Date(latest.timestamp).getTime();
    return elapsed > thresholdMinutes * 60 * 1000;
  }

  getBehindSchedule(
    estimatedDurationMinutes: number,
  ): Array<{ taskId: string; report: ProgressReport; expectedPercent: number }> {
    const results: Array<{ taskId: string; report: ProgressReport; expectedPercent: number }> = [];

    for (const [taskId, history] of this.reports) {
      if (history.length === 0) continue;

      const firstTimestamp = new Date(history[0].timestamp).getTime();
      const elapsedMs = Date.now() - firstTimestamp;
      const elapsedMinutes = elapsedMs / (60 * 1000);

      const expectedPercent = Math.min(
        100,
        (elapsedMinutes / estimatedDurationMinutes) * 100,
      );

      const latest = history[history.length - 1];
      if (latest.percent < expectedPercent) {
        results.push({ taskId, report: latest, expectedPercent });
      }
    }

    return results;
  }

  clear(taskId: string): void {
    this.reports.delete(taskId);
  }
}
