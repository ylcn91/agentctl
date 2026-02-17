import { test, expect, describe, beforeEach } from "bun:test";
import {
  HealthMonitor,
  HealthChecker,
  HEALTH_CHECK_INTERVAL_MS,
  type HealthCheckFn,
  type HealthCheckerDeps,
} from "../src/daemon/health-monitor";
import { EventBus } from "../src/services/event-bus";

let monitor: HealthMonitor;
let eventBus: EventBus;

beforeEach(() => {
  monitor = new HealthMonitor();
  eventBus = new EventBus();
});

function makeDeps(overrides?: Partial<HealthCheckerDeps>): HealthCheckerDeps {
  const checkFn: HealthCheckFn = async () => ({ ok: true, latencyMs: 5 });
  return {
    monitor,
    eventBus,
    checkFn,
    accounts: () => ["alice", "bob"],
    intervalMs: 60_000,
    ...overrides,
  };
}

describe("HealthChecker", () => {
  test("starts and stops without error", () => {
    const checker = new HealthChecker(makeDeps());
    checker.start();
    expect(checker.isRunning).toBe(true);
    checker.stop();
    expect(checker.isRunning).toBe(false);
  });

  test("start is idempotent", () => {
    const checker = new HealthChecker(makeDeps());
    checker.start();
    checker.start();
    expect(checker.isRunning).toBe(true);
    checker.stop();
  });

  test("runChecks marks healthy accounts as active", async () => {
    const checker = new HealthChecker(makeDeps());
    await checker.runChecks();

    const alice = monitor.getHealth("alice");
    expect(alice).not.toBeNull();
    expect(alice!.connected).toBe(true);
    expect(alice!.status).toBe("healthy");

    const bob = monitor.getHealth("bob");
    expect(bob).not.toBeNull();
    expect(bob!.connected).toBe(true);
  });

  test("runChecks marks failed accounts as disconnected", async () => {
    const failingCheck: HealthCheckFn = async () => ({ ok: false, latencyMs: 100 });
    const checker = new HealthChecker(makeDeps({ checkFn: failingCheck }));
    await checker.runChecks();

    const alice = monitor.getHealth("alice");
    expect(alice).not.toBeNull();
    expect(alice!.connected).toBe(false);
    expect(alice!.status).toBe("critical");
  });

  test("emits ACCOUNT_HEALTH events for each account", async () => {
    const events: any[] = [];
    eventBus.on("ACCOUNT_HEALTH", (e) => events.push(e));

    const checker = new HealthChecker(makeDeps());
    await checker.runChecks();

    expect(events).toHaveLength(2);
    expect(events[0].agent).toBe("alice");
    expect(events[0].status).toBe("healthy");
    expect(events[0].latencyMs).toBe(5);
    expect(events[1].agent).toBe("bob");
  });

  test("emits critical status for failed checks", async () => {
    const events: any[] = [];
    eventBus.on("ACCOUNT_HEALTH", (e) => events.push(e));

    const failingCheck: HealthCheckFn = async () => ({ ok: false, latencyMs: 50 });
    const checker = new HealthChecker(makeDeps({ checkFn: failingCheck }));
    await checker.runChecks();

    expect(events[0].status).toBe("critical");
  });

  test("calls onCritical callback for failed accounts", async () => {
    const criticalAccounts: string[] = [];
    const failingCheck: HealthCheckFn = async () => ({ ok: false, latencyMs: 50 });
    const checker = new HealthChecker(
      makeDeps({
        checkFn: failingCheck,
        onCritical: (account) => criticalAccounts.push(account),
      }),
    );
    await checker.runChecks();

    expect(criticalAccounts).toEqual(["alice", "bob"]);
  });

  test("does not call onCritical for healthy accounts", async () => {
    const criticalAccounts: string[] = [];
    const checker = new HealthChecker(
      makeDeps({
        onCritical: (account) => criticalAccounts.push(account),
      }),
    );
    await checker.runChecks();

    expect(criticalAccounts).toHaveLength(0);
  });

  test("handles check function throwing", async () => {
    const events: any[] = [];
    eventBus.on("ACCOUNT_HEALTH", (e) => events.push(e));

    const throwingCheck: HealthCheckFn = async () => {
      throw new Error("connection refused");
    };
    const checker = new HealthChecker(makeDeps({ checkFn: throwingCheck }));
    await checker.runChecks();

    expect(events).toHaveLength(2);
    expect(events[0].status).toBe("critical");
    expect(events[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("handles check timeout", async () => {
    const events: any[] = [];
    eventBus.on("ACCOUNT_HEALTH", (e) => events.push(e));

    const hangingCheck: HealthCheckFn = () =>
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10));
    const checker = new HealthChecker(
      makeDeps({ checkFn: hangingCheck, accounts: () => ["slow-acct"] }),
    );
    await checker.runChecks();

    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe("slow-acct");
    expect(events[0].status).toBe("critical");
  });

  test("skips if previous round still running", async () => {
    let callCount = 0;
    const slowCheck: HealthCheckFn = async () => {
      callCount++;
      await Bun.sleep(50);
      return { ok: true, latencyMs: 50 };
    };
    const checker = new HealthChecker(makeDeps({ checkFn: slowCheck, accounts: () => ["a"] }));

    const p1 = checker.runChecks();
    const p2 = checker.runChecks();
    await Promise.all([p1, p2]);

    expect(callCount).toBe(1);
  });

  test("uses default interval when not specified", () => {
    const deps = makeDeps();
    delete (deps as any).intervalMs;
    const checker = new HealthChecker(deps);
    checker.start();
    checker.stop();
  });

  test("handles empty account list", async () => {
    const events: any[] = [];
    eventBus.on("ACCOUNT_HEALTH", (e) => events.push(e));

    const checker = new HealthChecker(makeDeps({ accounts: () => [] }));
    await checker.runChecks();

    expect(events).toHaveLength(0);
  });

  test("checks dynamic account list on each run", async () => {
    let accounts = ["alice"];
    const checker = new HealthChecker(makeDeps({ accounts: () => accounts }));

    await checker.runChecks();
    expect(monitor.getHealth("alice")).not.toBeNull();
    expect(monitor.getHealth("bob")).toBeNull();

    accounts = ["alice", "bob"];
    await checker.runChecks();
    expect(monitor.getHealth("bob")).not.toBeNull();
  });
});
