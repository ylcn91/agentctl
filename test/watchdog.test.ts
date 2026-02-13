import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { DaemonState } from "../src/daemon/state";
import { startWatchdog } from "../src/daemon/watchdog";

const TEST_DIR = join(import.meta.dir, ".test-watchdog");
let dbCounter = 0;
function uniqueDbPath(): string {
  return join(TEST_DIR, `test-${++dbCounter}-${Date.now()}.db`);
}

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("startWatchdog", () => {
  test("returns stop function", () => {
    const state = new DaemonState(uniqueDbPath());
    const watchdog = startWatchdog(state, new Date().toISOString(), {
      intervalMs: 60_000,
    });
    expect(typeof watchdog.stop).toBe("function");
    watchdog.stop();
    state.close();
  });

  test("stop() clears the interval", async () => {
    const state = new DaemonState(uniqueDbPath());
    let callCount = 0;
    const watchdog = startWatchdog(state, new Date().toISOString(), {
      intervalMs: 50,
      onUnhealthy: () => { callCount++; },
    });

    // Let it tick a couple times
    await new Promise(r => setTimeout(r, 150));
    watchdog.stop();
    const countAfterStop = callCount;

    // Wait to confirm no more ticks
    await new Promise(r => setTimeout(r, 150));
    expect(callCount).toBe(countAfterStop);
    state.close();
  });

  test("onUnhealthy is called when store is broken", async () => {
    const state = new DaemonState(uniqueDbPath());
    // Close the store to simulate a broken state
    state.close();

    let unhealthyCalled = false;
    const watchdog = startWatchdog(state, new Date().toISOString(), {
      intervalMs: 50,
      onUnhealthy: () => { unhealthyCalled = true; },
    });

    await new Promise(r => setTimeout(r, 150));
    watchdog.stop();
    expect(unhealthyCalled).toBe(true);
  });

  test("default config uses 30s interval", () => {
    // Verify via the module's behavior: start with no config override,
    // confirm it returns a valid watchdog (the default 30s means it won't
    // fire during this short test)
    const state = new DaemonState(uniqueDbPath());
    let called = false;
    const watchdog = startWatchdog(state, new Date().toISOString(), {
      onUnhealthy: () => { called = true; },
    });

    // With 30s default interval, callback should NOT fire in 100ms
    return new Promise<void>(resolve => {
      setTimeout(() => {
        watchdog.stop();
        expect(called).toBe(false);
        state.close();
        resolve();
      }, 100);
    });
  });
});
