import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createLogger, setLogLevel, setLogPath } from "../src/services/logger";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-logger-" + Date.now());
const TEST_LOG = join(TEST_DIR, "test.log");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  setLogPath(TEST_LOG);
  setLogLevel("debug");
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe("logger", () => {
  test("createLogger returns all level methods", () => {
    const log = createLogger("test");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  test("writes NDJSON entries to log file", async () => {
    const log = createLogger("test-component");
    log.info("hello world", { key: "value" });
    await Bun.sleep(100);
    const content = await Bun.file(TEST_LOG).text();
    const entry = JSON.parse(content.trim());
    expect(entry.level).toBe("info");
    expect(entry.component).toBe("test-component");
    expect(entry.msg).toBe("hello world");
    expect(entry.data).toEqual({ key: "value" });
    expect(entry.ts).toBeTruthy();
  });

  test("respects log level filtering", async () => {
    setLogLevel("warn");
    const log = createLogger("filter-test");
    log.debug("should not appear");
    log.info("should not appear");
    log.warn("should appear");
    await Bun.sleep(100);
    const content = await Bun.file(TEST_LOG).text();
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).level).toBe("warn");
  });

  test("handles missing data gracefully", async () => {
    const log = createLogger("no-data");
    log.error("just a message");
    await Bun.sleep(100);
    const content = await Bun.file(TEST_LOG).text();
    const entry = JSON.parse(content.trim());
    expect(entry.data).toBeUndefined();
  });
});
