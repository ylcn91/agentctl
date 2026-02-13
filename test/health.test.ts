import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { DaemonState } from "../src/daemon/state";
import { getHealthStatus, selfTest } from "../src/daemon/health";

const TEST_DIR = join(import.meta.dir, ".test-health");
let dbCounter = 0;
function uniqueDbPath(): string {
  return join(TEST_DIR, `test-${++dbCounter}-${Date.now()}.db`);
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("getHealthStatus", () => {
  test("returns correct pid", () => {
    const state = new DaemonState(uniqueDbPath());
    const status = getHealthStatus(state, new Date().toISOString());
    expect(status.pid).toBe(process.pid);
    state.close();
  });

  test("returns positive uptime", () => {
    const state = new DaemonState(uniqueDbPath());
    const pastDate = new Date(Date.now() - 5000).toISOString();
    const status = getHealthStatus(state, pastDate);
    expect(status.uptime).toBeGreaterThan(0);
    state.close();
  });

  test("reports connectedAccounts correctly", () => {
    const state = new DaemonState(uniqueDbPath());
    expect(getHealthStatus(state, new Date().toISOString()).connectedAccounts).toBe(0);

    state.connectAccount("alice", "tok-a");
    state.connectAccount("bob", "tok-b");
    expect(getHealthStatus(state, new Date().toISOString()).connectedAccounts).toBe(2);

    state.disconnectAccount("alice");
    expect(getHealthStatus(state, new Date().toISOString()).connectedAccounts).toBe(1);
    state.close();
  });

  test("reports messageStoreOk = true for healthy store", () => {
    const state = new DaemonState(uniqueDbPath());
    const status = getHealthStatus(state, new Date().toISOString());
    expect(status.messageStoreOk).toBe(true);
    state.close();
  });

  test("reports memoryUsageMb as number > 0", () => {
    const state = new DaemonState(uniqueDbPath());
    const status = getHealthStatus(state, new Date().toISOString());
    expect(typeof status.memoryUsageMb).toBe("number");
    expect(status.memoryUsageMb).toBeGreaterThan(0);
    state.close();
  });
});

describe("selfTest", () => {
  test("returns false for non-existent socket path", async () => {
    const result = await selfTest("/tmp/nonexistent-health-test.sock");
    expect(result).toBe(false);
  });
});
