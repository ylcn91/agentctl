
import { test, expect, describe } from "bun:test";
import { MODEL_CONTEXT_LIMIT, CONTEXT_SAFETY_MARGIN } from "../src/constants";

describe("context budget constants", () => {
  test("MODEL_CONTEXT_LIMIT is 200k", () => {
    expect(MODEL_CONTEXT_LIMIT).toBe(200_000);
  });

  test("CONTEXT_SAFETY_MARGIN is 20k", () => {
    expect(CONTEXT_SAFETY_MARGIN).toBe(20_000);
  });

  test("budget threshold is 180k", () => {
    expect(MODEL_CONTEXT_LIMIT - CONTEXT_SAFETY_MARGIN).toBe(180_000);
  });
});

describe("budget check logic", () => {
  function shouldBreakLoop(inputTokens: number | undefined): boolean {
    return !!(inputTokens && inputTokens >= MODEL_CONTEXT_LIMIT - CONTEXT_SAFETY_MARGIN);
  }

  test("does not break when inputTokens undefined", () => {
    expect(shouldBreakLoop(undefined)).toBe(false);
  });

  test("does not break at low token count", () => {
    expect(shouldBreakLoop(5000)).toBe(false);
  });

  test("does not break just below threshold (179999)", () => {
    expect(shouldBreakLoop(179_999)).toBe(false);
  });

  test("breaks exactly at threshold (180000)", () => {
    expect(shouldBreakLoop(180_000)).toBe(true);
  });

  test("breaks above threshold", () => {
    expect(shouldBreakLoop(195_000)).toBe(true);
  });

  test("breaks at max context limit", () => {
    expect(shouldBreakLoop(200_000)).toBe(true);
  });

  test("does not break when inputTokens is 0", () => {
    expect(shouldBreakLoop(0)).toBe(false);
  });
});
