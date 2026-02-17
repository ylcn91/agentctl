import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { TddEngine } from "../src/services/tdd-engine";
import { EventBus } from "../src/services/event-bus";

const TEST_DIR = join(import.meta.dir, ".test-tdd-streaming");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeTestFile(name: string, content: string): string {
  const path = join(TEST_DIR, name);
  writeFileSync(path, content);
  return path;
}

describe("TDD_TEST_OUTPUT streaming", () => {
  test("emits output lines during test run", async () => {
    const testPath = writeTestFile(
      "stream.test.ts",
      `import { test, expect } from "bun:test";\ntest("ok", () => { expect(1).toBe(1); });\n`,
    );
    const bus = new EventBus({ maxRecent: 500 });
    const outputEvents: any[] = [];
    bus.on("TDD_TEST_OUTPUT" as any, (e) => outputEvents.push(e));

    const engine = new TddEngine({ testFile: testPath, eventBus: bus });
    engine.start();
    await engine.runTests();

    expect(outputEvents.length).toBeGreaterThan(0);
    for (const e of outputEvents) {
      expect(e.stream === "stdout" || e.stream === "stderr").toBe(true);
      expect(e.testFile).toBe(testPath);
      expect(typeof e.line).toBe("string");
    }

    engine.stop();
  });

  test("output lines match final output content", async () => {
    const testPath = writeTestFile(
      "match.test.ts",
      `import { test, expect } from "bun:test";\ntest("check", () => { expect(42).toBe(42); });\n`,
    );
    const bus = new EventBus({ maxRecent: 500 });
    const lines: string[] = [];
    bus.on("TDD_TEST_OUTPUT" as any, (e: any) => lines.push(e.line));

    const engine = new TddEngine({ testFile: testPath, eventBus: bus });
    engine.start();
    const result = await engine.runTests();

    const streamedOutput = lines.join("\n");
    expect(result.output).toBe(streamedOutput);

    engine.stop();
  });

  test("no TDD_TEST_OUTPUT without eventBus", async () => {
    const testPath = writeTestFile(
      "no-bus.test.ts",
      `import { test, expect } from "bun:test";\ntest("ok", () => { expect(true).toBe(true); });\n`,
    );
    const engine = new TddEngine({ testFile: testPath });
    engine.start();
    const result = await engine.runTests();
    expect(result.passed).toBe(true);
    engine.stop();
  });

  test("TDD_TEST_PASS emitted after all output lines", async () => {
    const testPath = writeTestFile(
      "order.test.ts",
      `import { test, expect } from "bun:test";\ntest("ok", () => { expect(1).toBe(1); });\n`,
    );
    const bus = new EventBus({ maxRecent: 500 });
    const allEvents: any[] = [];
    bus.on("*", (e) => allEvents.push(e));

    const engine = new TddEngine({ testFile: testPath, eventBus: bus });
    engine.start();
    await engine.runTests();

    const types = allEvents.map((e) => e.type);
    const lastOutputIdx = types.lastIndexOf("TDD_TEST_OUTPUT");
    const passIdx = types.indexOf("TDD_TEST_PASS");
    expect(passIdx).toBeGreaterThan(lastOutputIdx);

    engine.stop();
  });
});

describe("output truncation", () => {
  test("output is bounded (does not crash with many lines)", async () => {
    const testPath = writeTestFile(
      "bounded.test.ts",
      `import { test, expect } from "bun:test";\n` +
      Array.from({ length: 20 }, (_, i) => `test("t${i}", () => { expect(${i}).toBe(${i}); });\n`).join(""),
    );

    const engine = new TddEngine({ testFile: testPath });
    engine.start();
    const result = await engine.runTests();
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output.split("\n").length).toBeLessThanOrEqual(10_000);
    engine.stop();
  });
});

describe("watch debounce", () => {
  test("watcher starts without error", () => {
    const testPath = writeTestFile("watch.test.ts", `import { test } from "bun:test";\ntest("ok", () => {});\n`);
    const engine = new TddEngine({ testFile: testPath, watchMode: true });
    engine.start();
    expect(engine.getPhase()).toBe("red");
    engine.stop();
    expect(engine.getPhase()).toBe("idle");
  });

  test("stop clears debounce timer", () => {
    const testPath = writeTestFile("debounce.test.ts", `import { test } from "bun:test";\ntest("ok", () => {});\n`);
    const engine = new TddEngine({ testFile: testPath, watchMode: true });
    engine.start();
    expect(engine["watchDebounce"]).toBeNull();
    engine.stop();
  });
});
