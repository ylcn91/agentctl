
import { BaseStore } from "./base-store";

export type TrustLevel = "low" | "medium" | "high";

export interface AgentReputation {
  accountName: string;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  totalTasksRejected: number;
  completionRate: number;
  slaComplianceRate: number;
  averageCompletionMinutes: number;
  qualityVariance: number;
  criticalFailureCount: number;
  progressReportingRate: number;
  trustScore: number;
  trustLevel: TrustLevel;
  lastUpdated: string;
}

export function computeTrustLevel(score: number): TrustLevel {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function computeTrustScore(rep: Omit<AgentReputation, "trustScore" | "trustLevel" | "lastUpdated">): number {
  const total = rep.totalTasksCompleted + rep.totalTasksFailed + rep.totalTasksRejected;

  if (total === 0) return 50;

  const completionScore = rep.completionRate * 35;
  const slaScore = rep.slaComplianceRate * 25;
  const qualityScore = Math.max(0, 20 - rep.criticalFailureCount * 5 - rep.qualityVariance * 10);
  const behavioralScore = rep.progressReportingRate * 10;

  const volumeBonus = Math.min(10, total * 0.5);

  return Math.max(0, Math.min(100, Math.round(
    completionScore + slaScore + qualityScore + behavioralScore + volumeBonus
  )));
}

export class TrustStore extends BaseStore {
  protected createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trust (
        account_name TEXT PRIMARY KEY,
        total_tasks_completed INTEGER NOT NULL DEFAULT 0,
        total_tasks_failed INTEGER NOT NULL DEFAULT 0,
        total_tasks_rejected INTEGER NOT NULL DEFAULT 0,
        completion_rate REAL NOT NULL DEFAULT 0,
        sla_compliance_rate REAL NOT NULL DEFAULT 1,
        average_completion_minutes REAL NOT NULL DEFAULT 0,
        quality_variance REAL NOT NULL DEFAULT 0,
        critical_failure_count INTEGER NOT NULL DEFAULT 0,
        progress_reporting_rate REAL NOT NULL DEFAULT 0,
        trust_score INTEGER NOT NULL DEFAULT 50,
        trust_level TEXT NOT NULL DEFAULT 'medium',
        last_updated TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trust_history (
        id TEXT PRIMARY KEY,
        account_name TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        old_score INTEGER NOT NULL,
        new_score INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trust_history_account ON trust_history(account_name);
      CREATE INDEX IF NOT EXISTS idx_trust_history_timestamp ON trust_history(timestamp);
    `);
  }

  get(accountName: string): AgentReputation | null {
    const row = this.db.prepare("SELECT * FROM trust WHERE account_name = ?").get(accountName) as any;
    if (!row) return null;
    return this.rowToReputation(row);
  }

  getAll(): AgentReputation[] {
    return (this.db.prepare("SELECT * FROM trust ORDER BY trust_score DESC").all() as any[]).map(this.rowToReputation);
  }

  upsert(rep: AgentReputation): void {
    this.db.prepare(`
      INSERT INTO trust (account_name, total_tasks_completed, total_tasks_failed, total_tasks_rejected,
        completion_rate, sla_compliance_rate, average_completion_minutes, quality_variance,
        critical_failure_count, progress_reporting_rate, trust_score, trust_level, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_name) DO UPDATE SET
        total_tasks_completed = excluded.total_tasks_completed,
        total_tasks_failed = excluded.total_tasks_failed,
        total_tasks_rejected = excluded.total_tasks_rejected,
        completion_rate = excluded.completion_rate,
        sla_compliance_rate = excluded.sla_compliance_rate,
        average_completion_minutes = excluded.average_completion_minutes,
        quality_variance = excluded.quality_variance,
        critical_failure_count = excluded.critical_failure_count,
        progress_reporting_rate = excluded.progress_reporting_rate,
        trust_score = excluded.trust_score,
        trust_level = excluded.trust_level,
        last_updated = excluded.last_updated
    `).run(
      rep.accountName, rep.totalTasksCompleted, rep.totalTasksFailed, rep.totalTasksRejected,
      rep.completionRate, rep.slaComplianceRate, rep.averageCompletionMinutes, rep.qualityVariance,
      rep.criticalFailureCount, rep.progressReportingRate, rep.trustScore, rep.trustLevel, rep.lastUpdated
    );
  }

  recordOutcome(accountName: string, outcome: "completed" | "failed" | "rejected", durationMinutes?: number, wasCritical?: boolean): void {
    const current = this.get(accountName) ?? this.defaultReputation(accountName);
    const now = new Date().toISOString();
    const oldScore = current.trustScore;

    if (outcome === "completed") {
      current.totalTasksCompleted++;
    } else if (outcome === "failed") {
      current.totalTasksFailed++;
      if (wasCritical) current.criticalFailureCount++;
    } else {
      current.totalTasksRejected++;
    }

    const total = current.totalTasksCompleted + current.totalTasksFailed + current.totalTasksRejected;
    current.completionRate = total > 0 ? current.totalTasksCompleted / total : 0;

    if (durationMinutes !== undefined && outcome === "completed") {
      const prevTotal = current.totalTasksCompleted - 1;
      current.averageCompletionMinutes = prevTotal > 0
        ? (current.averageCompletionMinutes * prevTotal + durationMinutes) / current.totalTasksCompleted
        : durationMinutes;
    }

    current.trustScore = computeTrustScore(current);
    current.trustLevel = computeTrustLevel(current.trustScore);
    current.lastUpdated = now;
    this.upsert(current);

    const delta = current.trustScore - oldScore;
    if (delta !== 0) {
      this.db.prepare(
        "INSERT INTO trust_history (id, account_name, timestamp, delta, reason, old_score, new_score) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(crypto.randomUUID(), accountName, now, delta, `task_${outcome}`, oldScore, current.trustScore);
    }
  }

  applyDelta(accountName: string, delta: number, reason: string): AgentReputation {
    const current = this.get(accountName) ?? this.defaultReputation(accountName);
    const now = new Date().toISOString();
    const oldScore = current.trustScore;

    current.trustScore = Math.max(0, Math.min(100, current.trustScore + delta));
    current.trustLevel = computeTrustLevel(current.trustScore);
    current.lastUpdated = now;
    this.upsert(current);

    this.db.prepare(
      "INSERT INTO trust_history (id, account_name, timestamp, delta, reason, old_score, new_score) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), accountName, now, delta, reason, oldScore, current.trustScore);

    return current;
  }

  getHistory(accountName: string, limit = 50): Array<{ id: string; timestamp: string; delta: number; reason: string; oldScore: number; newScore: number }> {
    return (this.db.prepare(
      "SELECT * FROM trust_history WHERE account_name = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(accountName, limit) as any[]).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      delta: row.delta,
      reason: row.reason,
      oldScore: row.old_score,
      newScore: row.new_score,
    }));
  }

  private defaultReputation(accountName: string): AgentReputation {
    return {
      accountName,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalTasksRejected: 0,
      completionRate: 0,
      slaComplianceRate: 1,
      averageCompletionMinutes: 0,
      qualityVariance: 0,
      criticalFailureCount: 0,
      progressReportingRate: 0,
      trustScore: 50,
      trustLevel: "medium",
      lastUpdated: new Date().toISOString(),
    };
  }

  private rowToReputation(row: any): AgentReputation {
    return {
      accountName: row.account_name,
      totalTasksCompleted: row.total_tasks_completed,
      totalTasksFailed: row.total_tasks_failed,
      totalTasksRejected: row.total_tasks_rejected,
      completionRate: row.completion_rate,
      slaComplianceRate: row.sla_compliance_rate,
      averageCompletionMinutes: row.average_completion_minutes,
      qualityVariance: row.quality_variance,
      criticalFailureCount: row.critical_failure_count,
      progressReportingRate: row.progress_reporting_rate,
      trustScore: row.trust_score,
      trustLevel: row.trust_level as TrustLevel,
      lastUpdated: row.last_updated,
    };
  }
}
