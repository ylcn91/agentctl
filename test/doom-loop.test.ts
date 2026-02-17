import { test, expect, describe, beforeEach } from "bun:test";
import {
  DoomLoopDetector,
  DOOM_LOOP_THRESHOLD,
  normalizeToolInput,
} from "../src/services/doom-loop";

describe("DoomLoopDetector", () => {
  let detector: DoomLoopDetector;

  beforeEach(() => {
    detector = new DoomLoopDetector();
  });

  test("does not trigger before threshold reached", () => {
    expect(detector.record({ name: "Read", input: "/foo.ts" })).toBe(false);
    expect(detector.record({ name: "Read", input: "/foo.ts" })).toBe(false);
    expect(detector.wasTriggered()).toBe(false);
  });

  test("triggers on 3 identical consecutive calls", () => {
    expect(detector.record({ name: "Read", input: "/foo.ts" })).toBe(false);
    expect(detector.record({ name: "Read", input: "/foo.ts" })).toBe(false);
    expect(detector.record({ name: "Read", input: "/foo.ts" })).toBe(true);
    expect(detector.wasTriggered()).toBe(true);
  });

  test("does not trigger with different tool names", () => {
    detector.record({ name: "Read", input: "/foo.ts" });
    detector.record({ name: "Write", input: "/foo.ts" });
    expect(detector.record({ name: "Read", input: "/foo.ts" })).toBe(false);
  });

  test("does not trigger with different inputs", () => {
    detector.record({ name: "Read", input: "/foo.ts" });
    detector.record({ name: "Read", input: "/bar.ts" });
    expect(detector.record({ name: "Read", input: "/foo.ts" })).toBe(false);
  });

  test("triggers after intervening non-matching call resets window", () => {
    detector.record({ name: "Read", input: "/foo.ts" });
    detector.record({ name: "Read", input: "/foo.ts" });
    detector.record({ name: "Write", input: "/bar.ts" });
    detector.record({ name: "Read", input: "/foo.ts" });
    detector.record({ name: "Read", input: "/foo.ts" });
    expect(detector.record({ name: "Read", input: "/foo.ts" })).toBe(true);
  });

  test("custom threshold", () => {
    const custom = new DoomLoopDetector(2);
    expect(custom.record({ name: "Grep", input: "pattern" })).toBe(false);
    expect(custom.record({ name: "Grep", input: "pattern" })).toBe(true);
  });

  test("getRepeatedCall returns the repeated call info", () => {
    detector.record({ name: "Bash", input: "ls -la" });
    detector.record({ name: "Bash", input: "ls -la" });
    detector.record({ name: "Bash", input: "ls -la" });
    const call = detector.getRepeatedCall();
    expect(call).toEqual({ name: "Bash", input: "ls -la" });
  });

  test("getRepeatedCall returns undefined when not triggered", () => {
    detector.record({ name: "Read", input: "/foo" });
    expect(detector.getRepeatedCall()).toBeUndefined();
  });

  test("formatMessage includes tool name and input", () => {
    detector.record({ name: "Grep", input: "pattern" });
    detector.record({ name: "Grep", input: "pattern" });
    detector.record({ name: "Grep", input: "pattern" });
    const msg = detector.formatMessage();
    expect(msg).toContain("Grep");
    expect(msg).toContain("pattern");
    expect(msg).toContain("3 times");
  });

  test("formatMessage truncates long input", () => {
    const longInput = "x".repeat(200);
    detector.record({ name: "Read", input: longInput });
    detector.record({ name: "Read", input: longInput });
    detector.record({ name: "Read", input: longInput });
    const msg = detector.formatMessage();
    expect(msg).toContain("...");
    expect(msg.length).toBeLessThan(300);
  });

  test("reset clears history and triggered state", () => {
    detector.record({ name: "Read", input: "/foo" });
    detector.record({ name: "Read", input: "/foo" });
    detector.record({ name: "Read", input: "/foo" });
    expect(detector.wasTriggered()).toBe(true);

    detector.reset();
    expect(detector.wasTriggered()).toBe(false);
    expect(detector.count).toBe(0);
    expect(detector.getRepeatedCall()).toBeUndefined();
  });

  test("count tracks recorded calls", () => {
    expect(detector.count).toBe(0);
    detector.record({ name: "Read", input: "/a" });
    expect(detector.count).toBe(1);
    detector.record({ name: "Read", input: "/b" });
    expect(detector.count).toBe(2);
  });

  test("bounds memory to threshold entries", () => {
    for (let i = 0; i < 100; i++) {
      detector.record({ name: "Read", input: `/file${i}` });
    }
    // Should only keep last DOOM_LOOP_THRESHOLD entries
    expect(detector.count).toBe(DOOM_LOOP_THRESHOLD);
  });

  test("DOOM_LOOP_THRESHOLD is 3", () => {
    expect(DOOM_LOOP_THRESHOLD).toBe(3);
  });
});

describe("normalizeToolInput", () => {
  test("returns string input as-is", () => {
    expect(normalizeToolInput("hello")).toBe("hello");
  });

  test("stringifies object input with sorted keys", () => {
    const result = normalizeToolInput({ b: 2, a: 1 });
    expect(result).toBe('{"a":1,"b":2}');
  });

  test("handles null and undefined", () => {
    expect(normalizeToolInput(null)).toBe("");
    expect(normalizeToolInput(undefined)).toBe("");
  });

  test("handles numbers", () => {
    expect(normalizeToolInput(42)).toBe("42");
  });
});
