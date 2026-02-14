import { test, expect } from "bun:test";
import { evaluateCondition, type EvalContext } from "../src/services/condition-evaluator";

function makeContext(overrides?: Partial<EvalContext>): EvalContext {
  return {
    steps: overrides?.steps ?? new Map(),
    trigger: overrides?.trigger ?? { context: "" },
  };
}

test("step.review.result == 'accepted' returns true when matched", () => {
  const ctx = makeContext({
    steps: new Map([["review", { result: "accepted" }]]),
  });
  expect(evaluateCondition("step.review.result == 'accepted'", ctx)).toBe(true);
});

test("step.review.result == 'accepted' returns false when not matched", () => {
  const ctx = makeContext({
    steps: new Map([["review", { result: "rejected" }]]),
  });
  expect(evaluateCondition("step.review.result == 'accepted'", ctx)).toBe(false);
});

test("step.review.result == 'rejected' returns true when matched", () => {
  const ctx = makeContext({
    steps: new Map([["review", { result: "rejected" }]]),
  });
  expect(evaluateCondition("step.review.result == 'rejected'", ctx)).toBe(true);
});

test("step.x.duration_ms > 300000 returns correct boolean", () => {
  const ctx1 = makeContext({
    steps: new Map([["x", { duration_ms: 500000 }]]),
  });
  expect(evaluateCondition("step.x.duration_ms > 300000", ctx1)).toBe(true);

  const ctx2 = makeContext({
    steps: new Map([["x", { duration_ms: 100000 }]]),
  });
  expect(evaluateCondition("step.x.duration_ms > 300000", ctx2)).toBe(false);
});

test("step.x.assignee == 'agent-a' matches", () => {
  const ctx = makeContext({
    steps: new Map([["x", { assignee: "agent-a" }]]),
  });
  expect(evaluateCondition("step.x.assignee == 'agent-a'", ctx)).toBe(true);
});

test("step.x.assignee == 'agent-a' does not match different assignee", () => {
  const ctx = makeContext({
    steps: new Map([["x", { assignee: "agent-b" }]]),
  });
  expect(evaluateCondition("step.x.assignee == 'agent-a'", ctx)).toBe(false);
});

test("trigger.context contains 'hotfix' matches substring", () => {
  const ctx = makeContext({
    trigger: { context: "deploying hotfix for auth bug" },
  });
  expect(evaluateCondition("trigger.context contains 'hotfix'", ctx)).toBe(true);
});

test("trigger.context contains 'hotfix' returns false when absent", () => {
  const ctx = makeContext({
    trigger: { context: "regular feature deploy" },
  });
  expect(evaluateCondition("trigger.context contains 'hotfix'", ctx)).toBe(false);
});

test("unknown expression format returns false (safe default)", () => {
  const ctx = makeContext();
  expect(evaluateCondition("some random garbage", ctx)).toBe(false);
  expect(evaluateCondition("", ctx)).toBe(false);
  expect(evaluateCondition("foo.bar.baz > 123", ctx)).toBe(false);
});

test("step with missing data returns false", () => {
  const ctx = makeContext({
    steps: new Map(),
  });
  expect(evaluateCondition("step.missing.result == 'accepted'", ctx)).toBe(false);
});
