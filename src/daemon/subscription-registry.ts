import type { Socket } from "net";
import type { DelegationEvent } from "../services/event-bus";
import { frameSend } from "./framing";
import { MAX_STREAM_CHUNK_BYTES } from "../constants";

const HEARTBEAT_INTERVAL_MS = 30_000;
const DRAIN_TIMEOUT_MS = 1_000;
const MAX_PENDING_WRITES = 500;

interface Subscription {
  socket: Socket;
  account: string;
  patterns: Set<string>;
  pendingWrites: number;
}

export class SubscriptionRegistry {
  private subscriptions = new Map<Socket, Subscription>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private drainTimeouts = new Set<ReturnType<typeof setTimeout>>();

  subscribe(socket: Socket, account: string, patterns: string[]): void {
    const existing = this.subscriptions.get(socket);
    if (existing) {
      for (const p of patterns) existing.patterns.add(p);
      return;
    }
    this.subscriptions.set(socket, {
      socket,
      account,
      patterns: new Set(patterns),
      pendingWrites: 0,
    });

    if (!this.heartbeatTimer && this.subscriptions.size > 0) {
      this.startHeartbeat();
    }
  }

  unsubscribe(socket: Socket, patterns?: string[]): void {
    if (!patterns) {
      this.subscriptions.delete(socket);
      this.maybeStopHeartbeat();
      return;
    }
    const sub = this.subscriptions.get(socket);
    if (!sub) return;
    for (const p of patterns) sub.patterns.delete(p);
    if (sub.patterns.size === 0) {
      this.subscriptions.delete(socket);
      this.maybeStopHeartbeat();
    }
  }

  removeSocket(socket: Socket): void {
    this.subscriptions.delete(socket);
    this.maybeStopHeartbeat();
  }

  broadcast(event: DelegationEvent & { id: string; timestamp: string }): void {
    const payload = frameSend({ type: "stream_event", event });

    if (payload.length > MAX_STREAM_CHUNK_BYTES) return;

    const dead: Socket[] = [];

    for (const [sock, sub] of this.subscriptions) {
      if (sock.destroyed || !sock.writable) {
        dead.push(sock);
        continue;
      }

      if (!this.matchesPatterns(event.type, sub.patterns)) continue;

      if (sub.pendingWrites >= MAX_PENDING_WRITES) {
        console.warn(`[subscription-registry] dropping event for ${sub.account}: ${sub.pendingWrites} pending writes`);
        continue;
      }

      sub.pendingWrites++;
      const ok = sock.write(payload);
      if (ok) {
        sub.pendingWrites--;
      } else {

        this.awaitDrain(sock, sub);
      }
    }

    for (const sock of dead) {
      this.subscriptions.delete(sock);
    }
    this.maybeStopHeartbeat();
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const t of this.drainTimeouts) clearTimeout(t);
    this.drainTimeouts.clear();
    this.subscriptions.clear();
  }

  private awaitDrain(sock: Socket, sub: Subscription): void {
    const timeout = setTimeout(() => {
      this.drainTimeouts.delete(timeout);

      sock.removeListener("drain", onDrain);
      console.warn(`[subscription-registry] drain timeout for ${sub.account}, removing socket`);
      sock.destroy();
      this.subscriptions.delete(sock);
      this.maybeStopHeartbeat();
    }, DRAIN_TIMEOUT_MS);

    this.drainTimeouts.add(timeout);

    const onDrain = () => {
      clearTimeout(timeout);
      this.drainTimeouts.delete(timeout);
      sub.pendingWrites--;
    };

    sock.once("drain", onDrain);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const heartbeat = frameSend({ type: "heartbeat" });
      const dead: Socket[] = [];

      for (const [sock, sub] of this.subscriptions) {
        if (sock.destroyed || !sock.writable) {
          dead.push(sock);
          continue;
        }
        sock.write(heartbeat);
      }

      for (const sock of dead) {
        this.subscriptions.delete(sock);
      }
      this.maybeStopHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    this.heartbeatTimer.unref();
  }

  private maybeStopHeartbeat(): void {
    if (this.heartbeatTimer && this.subscriptions.size === 0) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private matchesPatterns(eventType: string, patterns: Set<string>): boolean {
    if (patterns.has("*")) return true;
    if (patterns.has(eventType)) return true;

    for (const p of patterns) {
      if (p.endsWith("*") && eventType.startsWith(p.slice(0, -1))) return true;
    }
    return false;
  }
}
