export type HealthLevel = "healthy" | "degraded" | "critical";

export interface AccountHealth {
  account: string;
  status: HealthLevel;
  connected: boolean;
  lastActivity: string | null;
  errorCount: number;
  rateLimited: boolean;
  slaViolations: number;
  updatedAt: string;
}

export type HealthUpdateData = Partial<Omit<AccountHealth, "account" | "status" | "updatedAt">>;

export interface AggregateHealthStatus {
  overall: HealthLevel;
  healthy: number;
  degraded: number;
  critical: number;
  total: number;
  accounts: AccountHealth[];
}

import { STALE_THRESHOLD_MS } from "../constants";
import type { EventBus } from "../services/event-bus";

export class HealthMonitor {
  private healthMap = new Map<string, AccountHealth>();

  update(account: string, data: HealthUpdateData): AccountHealth {
    const existing = this.healthMap.get(account);
    const now = new Date().toISOString();

    const entry: AccountHealth = {
      account,
      status: "healthy",
      connected: data.connected ?? existing?.connected ?? false,
      lastActivity: data.lastActivity ?? existing?.lastActivity ?? null,
      errorCount: data.errorCount ?? existing?.errorCount ?? 0,
      rateLimited: data.rateLimited ?? existing?.rateLimited ?? false,
      slaViolations: data.slaViolations ?? existing?.slaViolations ?? 0,
      updatedAt: now,
    };

    entry.status = this.computeStatus(entry);
    this.healthMap.set(account, entry);
    return entry;
  }

  recordError(account: string): void {
    const existing = this.healthMap.get(account);
    const errorCount = (existing?.errorCount ?? 0) + 1;
    this.update(account, { errorCount });
  }

  recordRateLimit(account: string): void {
    this.update(account, { rateLimited: true });
  }

  clearRateLimit(account: string): void {
    this.update(account, { rateLimited: false });
  }

  recordSlaViolation(account: string): void {
    const existing = this.healthMap.get(account);
    const slaViolations = (existing?.slaViolations ?? 0) + 1;
    this.update(account, { slaViolations });
  }

  markActive(account: string): void {
    this.update(account, {
      connected: true,
      lastActivity: new Date().toISOString(),
    });
  }

  markDisconnected(account: string): void {
    this.update(account, { connected: false });
  }

  getHealth(account: string): AccountHealth | null {
    return this.healthMap.get(account) ?? null;
  }

  getStatuses(accountNames?: string[]): AccountHealth[] {
    const names = accountNames ?? Array.from(this.healthMap.keys());
    return names.map((name) => {
      const existing = this.healthMap.get(name);
      if (existing) {
        existing.status = this.computeStatus(existing);
        return existing;
      }
      return {
        account: name,
        status: "critical" as HealthLevel,
        connected: false,
        lastActivity: null,
        errorCount: 0,
        rateLimited: false,
        slaViolations: 0,
        updatedAt: new Date().toISOString(),
      };
    });
  }

  getAggregateStatus(accountNames?: string[]): AggregateHealthStatus {
    const accounts = this.getStatuses(accountNames);
    const healthy = accounts.filter((a) => a.status === "healthy").length;
    const degraded = accounts.filter((a) => a.status === "degraded").length;
    const critical = accounts.filter((a) => a.status === "critical").length;

    let overall: HealthLevel = "healthy";
    if (critical > 0) overall = "critical";
    else if (degraded > 0) overall = "degraded";

    return { overall, healthy, degraded, critical, total: accounts.length, accounts };
  }

  private computeStatus(entry: AccountHealth): HealthLevel {
    if (!entry.connected) return "critical";
    if (entry.rateLimited) return "critical";
    if (entry.errorCount >= 5) return "critical";

    if (entry.errorCount > 0) return "degraded";
    if (entry.slaViolations > 0) return "degraded";
    if (entry.lastActivity) {
      const elapsed = Date.now() - new Date(entry.lastActivity).getTime();
      if (elapsed > STALE_THRESHOLD_MS) return "degraded";
    }

    return "healthy";
  }
}

export const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

export type HealthCheckFn = (account: string) => Promise<{ ok: boolean; latencyMs: number }>;

export interface HealthCheckerDeps {
  monitor: HealthMonitor;
  eventBus: EventBus;
  checkFn: HealthCheckFn;
  accounts: () => string[];
  intervalMs?: number;
  onCritical?: (account: string) => void;
}

export class HealthChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private deps: HealthCheckerDeps;
  private intervalMs: number;
  private running = false;

  constructor(deps: HealthCheckerDeps) {
    this.deps = deps;
    this.intervalMs = deps.intervalMs ?? HEALTH_CHECK_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runChecks(), this.intervalMs);
    this.runChecks();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  async runChecks(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const accounts = this.deps.accounts();
      await Promise.allSettled(accounts.map((a) => this.checkAccount(a)));
    } finally {
      this.running = false;
    }
  }

  private async checkAccount(account: string): Promise<void> {
    const start = Date.now();
    let ok = false;
    let latencyMs = 0;

    try {
      const result = await Promise.race([
        this.deps.checkFn(account),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("health check timeout")), HEALTH_CHECK_TIMEOUT_MS),
        ),
      ]);
      ok = result.ok;
      latencyMs = result.latencyMs;
    } catch {
      ok = false;
      latencyMs = Date.now() - start;
    }

    const status: HealthLevel = ok ? "healthy" : "critical";

    if (ok) {
      this.deps.monitor.markActive(account);
    } else {
      this.deps.monitor.markDisconnected(account);
    }

    this.deps.eventBus.emit({
      type: "ACCOUNT_HEALTH",
      agent: account,
      status,
      latencyMs,
    });

    if (status === "critical" && this.deps.onCritical) {
      this.deps.onCritical(account);
    }
  }
}
