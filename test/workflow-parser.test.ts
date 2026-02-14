import { test, expect } from "bun:test";
import { parseWorkflow, validateDAG, topologicalSort, type WorkflowStep } from "../src/services/workflow-parser";

const linearYaml = `
name: deploy-feature
description: Simple linear workflow
version: 1
on_failure: notify
retro: false
steps:
  - id: implement
    title: Implement feature
    assign: auto
    handoff:
      goal: Build the feature
  - id: review
    title: Code review
    assign: reviewer
    depends_on: [implement]
    handoff:
      goal: Review the implementation
  - id: deploy
    title: Deploy
    assign: auto
    depends_on: [review]
    handoff:
      goal: Deploy to production
`;

const parallelYaml = `
name: parallel-review
version: 1
on_failure: abort
retro: true
steps:
  - id: implement
    title: Implement
    assign: auto
    handoff:
      goal: Build it
  - id: code_review
    title: Code review
    assign: reviewer-a
    depends_on: [implement]
    handoff:
      goal: Review code
  - id: security_review
    title: Security review
    assign: reviewer-b
    depends_on: [implement]
    handoff:
      goal: Review security
  - id: merge
    title: Merge
    assign: auto
    depends_on: [code_review, security_review]
    handoff:
      goal: Merge to main
`;

const conditionalYaml = `
name: conditional-flow
version: 1
on_failure: notify
retro: false
steps:
  - id: review
    title: Review
    assign: auto
    handoff:
      goal: Review the work
  - id: fix
    title: Fix issues
    assign: auto
    depends_on: [review]
    condition:
      when: "step.review.result == 'rejected'"
    handoff:
      goal: Fix review feedback
`;

const cyclicYaml = `
name: broken
version: 1
on_failure: notify
retro: false
steps:
  - id: a
    title: Step A
    assign: auto
    depends_on: [c]
    handoff:
      goal: Do A
  - id: b
    title: Step B
    assign: auto
    depends_on: [a]
    handoff:
      goal: Do B
  - id: c
    title: Step C
    assign: auto
    depends_on: [b]
    handoff:
      goal: Do C
`;

test("parse valid YAML with linear steps", () => {
  const def = parseWorkflow(linearYaml);
  expect(def.name).toBe("deploy-feature");
  expect(def.version).toBe(1);
  expect(def.steps).toHaveLength(3);
  expect(def.steps[0].id).toBe("implement");
  expect(def.steps[1].depends_on).toEqual(["implement"]);
  expect(def.steps[2].depends_on).toEqual(["review"]);
  expect(def.on_failure).toBe("notify");
  expect(def.retro).toBe(false);
});

test("parse YAML with parallel steps (fan-out/fan-in)", () => {
  const def = parseWorkflow(parallelYaml);
  expect(def.name).toBe("parallel-review");
  expect(def.steps).toHaveLength(4);
  expect(def.on_failure).toBe("abort");
  expect(def.retro).toBe(true);

  const merge = def.steps.find(s => s.id === "merge");
  expect(merge?.depends_on).toEqual(["code_review", "security_review"]);
});

test("parse YAML with conditions", () => {
  const def = parseWorkflow(conditionalYaml);
  expect(def.steps).toHaveLength(2);
  const fixStep = def.steps.find(s => s.id === "fix");
  expect(fixStep?.condition?.when).toBe("step.review.result == 'rejected'");
});

test("reject YAML with cycle (A->B->C->A)", () => {
  expect(() => parseWorkflow(cyclicYaml)).toThrow("cycle");
});

test("reject invalid schema (missing required fields)", () => {
  const bad = `
version: 1
steps: []
`;
  expect(() => parseWorkflow(bad)).toThrow();
});

test("topologicalSort returns correct order", () => {
  const steps: WorkflowStep[] = [
    { id: "c", title: "C", assign: "auto", depends_on: ["a", "b"], handoff: { goal: "C" } },
    { id: "a", title: "A", assign: "auto", handoff: { goal: "A" } },
    { id: "b", title: "B", assign: "auto", depends_on: ["a"], handoff: { goal: "B" } },
  ];
  const order = topologicalSort(steps);
  expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
  expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
  expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
});

test("validateDAG throws on unknown dependency", () => {
  const steps: WorkflowStep[] = [
    { id: "a", title: "A", assign: "auto", depends_on: ["nonexistent"], handoff: { goal: "A" } },
  ];
  expect(() => validateDAG(steps)).toThrow("unknown step");
});
