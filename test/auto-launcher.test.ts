import { describe, test, expect, beforeEach } from "bun:test";
import { AutoLauncher, type AutoLaunchPolicy } from "../src/daemon/auto-launcher";

const DEFAULT_POLICY: AutoLaunchPolicy = {
  maxSpawnsPerMinute: 2,
  deduplicationWindowMs: 30_000,
  selfHandoffBlocked: true,
  circuitBreaker: {
    failureThreshold: 3,
    cooldownMs: 5 * 60 * 1000,
  },
};

describe("AutoLauncher", () => {
  let launcher: AutoLauncher;

  beforeEach(() => {
    launcher = new AutoLauncher(DEFAULT_POLICY);
  });

  test("blocks self-handoff", () => {
    const result = launcher.canLaunch("claude-work", "claude-work");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("self-handoff");
  });

  test("allows handoff to different account", () => {
    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(true);
  });

  test("rate limit triggers after maxSpawnsPerMinute", () => {
    launcher.recordSpawn("claude-admin");
    launcher.recordSpawn("claude-ops");

    const result = launcher.canLaunch("claude-work", "claude-deploy");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("rate limit");
  });

  test("rate limit resets after window expires", () => {
    launcher.recordSpawn("claude-admin");
    launcher.recordSpawn("claude-ops");

    launcher.expireRateLimitForTest();

    const result = launcher.canLaunch("claude-work", "claude-deploy");
    expect(result.allowed).toBe(true);
  });

  test("deduplication blocks same target within window", () => {
    launcher.recordSpawn("claude-admin");

    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("dedup");
  });

  test("deduplication allows same target after window expires", () => {
    launcher.recordSpawn("claude-admin");

    launcher.expireDedupForTest("claude-admin");

    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(true);
  });

  test("circuit breaker opens after failure threshold", () => {
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");

    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("circuit breaker");
  });

  test("circuit breaker allows after cooldown", () => {
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");

    launcher.expireCircuitBreakerForTest("claude-admin");

    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(true);
  });

  test("circuit breaker resets failure count on successful spawn", () => {
    launcher.recordFailure("claude-admin");
    launcher.recordFailure("claude-admin");

    launcher.recordSpawn("claude-admin");

    launcher.expireDedupForTest("claude-admin");
    launcher.expireRateLimitForTest();

    launcher.recordFailure("claude-admin");
    const result = launcher.canLaunch("claude-work", "claude-admin");
    expect(result.allowed).toBe(true);
  });

  test("self-handoff allowed when policy disables it", () => {
    const permissive = new AutoLauncher({ ...DEFAULT_POLICY, selfHandoffBlocked: false });
    const result = permissive.canLaunch("claude-work", "claude-work");
    expect(result.allowed).toBe(true);
  });
});

describe("AutoLauncher rate limit boundary", () => {
  test("exactly maxSpawnsPerMinute spawns are allowed, next is blocked", () => {
    const launcher = new AutoLauncher({
      ...DEFAULT_POLICY,
      maxSpawnsPerMinute: 2,
    });

    launcher.recordSpawn("target-1");
    launcher.expireDedupForTest("target-1");

    launcher.recordSpawn("target-2");
    launcher.expireDedupForTest("target-2");

    const result = launcher.canLaunch("from", "target-3");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("rate limit");
    expect(result.reason).toContain("2/2");
  });

  test("2 spawns within limit are both allowed", () => {
    const launcher = new AutoLauncher({
      ...DEFAULT_POLICY,
      maxSpawnsPerMinute: 2,
    });

    const r1 = launcher.canLaunch("from", "target-1");
    expect(r1.allowed).toBe(true);
    launcher.recordSpawn("target-1");
    launcher.expireDedupForTest("target-1");

    const r2 = launcher.canLaunch("from", "target-2");
    expect(r2.allowed).toBe(true);
  });

  test("rate limit resets after expiry", () => {
    const launcher = new AutoLauncher({
      ...DEFAULT_POLICY,
      maxSpawnsPerMinute: 2,
    });

    launcher.recordSpawn("t1");
    launcher.recordSpawn("t2");
    launcher.expireDedupForTest("t1");
    launcher.expireDedupForTest("t2");

    expect(launcher.canLaunch("from", "t3").allowed).toBe(false);

    launcher.expireRateLimitForTest();

    expect(launcher.canLaunch("from", "t3").allowed).toBe(true);
  });
});

describe("AutoLauncher dedup window", () => {
  test("same target blocked within dedup window", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordSpawn("target-a");

    const result = launcher.canLaunch("from", "target-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("dedup");
  });

  test("same target allowed after dedup window expires", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordSpawn("target-a");

    launcher.expireDedupForTest("target-a");
    launcher.expireRateLimitForTest();

    const result = launcher.canLaunch("from", "target-a");
    expect(result.allowed).toBe(true);
  });

  test("different targets are not affected by each other's dedup", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordSpawn("target-a");

    const result = launcher.canLaunch("from", "target-b");
    expect(result.allowed).toBe(true);
  });
});

describe("AutoLauncher circuit breaker edge cases", () => {
  test("failures below threshold do not open circuit breaker", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordFailure("target-x");
    launcher.recordFailure("target-x");

    const result = launcher.canLaunch("from", "target-x");
    expect(result.allowed).toBe(true);
  });

  test("exactly failureThreshold failures opens circuit breaker", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordFailure("target-x");
    launcher.recordFailure("target-x");
    launcher.recordFailure("target-x");

    const result = launcher.canLaunch("from", "target-x");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("circuit breaker");
  });

  test("circuit breaker is per-target", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordFailure("bad-target");
    launcher.recordFailure("bad-target");
    launcher.recordFailure("bad-target");

    expect(launcher.canLaunch("from", "bad-target").allowed).toBe(false);
    expect(launcher.canLaunch("from", "good-target").allowed).toBe(true);
  });

  test("circuit breaker resets after cooldown expires", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordFailure("target-x");
    launcher.recordFailure("target-x");
    launcher.recordFailure("target-x");

    expect(launcher.canLaunch("from", "target-x").allowed).toBe(false);

    launcher.expireCircuitBreakerForTest("target-x");

    expect(launcher.canLaunch("from", "target-x").allowed).toBe(true);
  });

  test("successful spawn resets circuit breaker failure count", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordFailure("target-x");
    launcher.recordFailure("target-x");

    launcher.recordSpawn("target-x");
    launcher.expireDedupForTest("target-x");
    launcher.expireRateLimitForTest();

    launcher.recordFailure("target-x");
    launcher.recordFailure("target-x");
    expect(launcher.canLaunch("from", "target-x").allowed).toBe(true);

    launcher.recordFailure("target-x");
    expect(launcher.canLaunch("from", "target-x").allowed).toBe(false);
  });

  test("check order: self-handoff checked before circuit breaker", () => {
    const launcher = new AutoLauncher(DEFAULT_POLICY);
    launcher.recordFailure("claude-work");
    launcher.recordFailure("claude-work");
    launcher.recordFailure("claude-work");

    const result = launcher.canLaunch("claude-work", "claude-work");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("self-handoff");
  });
});
