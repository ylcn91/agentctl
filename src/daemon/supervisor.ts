import { selfTest } from "./health";
import type { Subprocess } from "bun";

export interface SupervisorConfig {
  healthCheckIntervalMs: number;
  maxRestarts: number;
  restartDelayMs: number;
  gracefulShutdownMs: number;
  sockPath: string;
  daemonScript: string;
}

const DEFAULTS: SupervisorConfig = {
  healthCheckIntervalMs: 30_000,
  maxRestarts: 5,
  restartDelayMs: 1_000,
  gracefulShutdownMs: 5_000,
  sockPath: "",
  daemonScript: "",
};

export function startSupervisor(config: Partial<SupervisorConfig> & Pick<SupervisorConfig, "sockPath" | "daemonScript">): { stop: () => Promise<void> } {
  const cfg = { ...DEFAULTS, ...config };
  let child: Subprocess | null = null;
  let restartCount = 0;
  let restartWindowStart = Date.now();
  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function spawnDaemon(): Subprocess {
    return Bun.spawn(["bun", cfg.daemonScript, "--supervised"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  }

  async function restart(): Promise<void> {
    if (stopped) return;

    if (Date.now() - restartWindowStart > 5 * 60 * 1000) {
      restartCount = 0;
      restartWindowStart = Date.now();
    }

    if (restartCount >= cfg.maxRestarts) {
      console.error("[supervisor] Circuit breaker: too many restarts, giving up");
      return;
    }

    const delay = cfg.restartDelayMs * Math.pow(2, restartCount);
    restartCount++;
    console.log(`[supervisor] Restarting in ${delay}ms (attempt ${restartCount}/${cfg.maxRestarts})`);

    await new Promise(r => setTimeout(r, delay));
    if (stopped) return;

    child = spawnDaemon();

    await new Promise(r => setTimeout(r, 2000));
  }

  child = spawnDaemon();

  healthCheckTimer = setInterval(async () => {
    if (stopped) return;
    const healthy = await selfTest(cfg.sockPath);
    if (!healthy && !stopped) {
      console.error("[supervisor] Health check failed, restarting daemon");
      if (child) {
        child.kill();
        child = null;
      }
      await restart();
    }
  }, cfg.healthCheckIntervalMs);

  return {
    stop: async () => {
      stopped = true;
      if (healthCheckTimer) clearInterval(healthCheckTimer);
      if (child) {
        child.kill("SIGTERM");

        const deadline = Date.now() + cfg.gracefulShutdownMs;
        while (child.exitCode === null && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }
    }
  };
}
