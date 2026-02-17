import { test, expect, describe, beforeEach, mock } from "bun:test";
import { registerStreamingHandlers } from "../src/daemon/handlers/streaming";
import { SubscriptionRegistry } from "../src/daemon/subscription-registry";
import type { HandlerContext } from "../src/daemon/handler-types";
import { EventEmitter } from "events";

function createMockSocket() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    destroyed: false,
    writable: true,
    write: () => true,
    once: (event: string, cb: () => void) => emitter.once(event, cb),
  }) as any;
}

function createMockContext(features?: Record<string, boolean>): HandlerContext {
  const written: string[] = [];
  const registry = new SubscriptionRegistry();

  return {
    state: {
      subscriptionRegistry: registry,
      eventBus: { on: () => () => {}, emit: () => "" } as any,
    } as any,
    features: features as any,
    councilConfig: undefined,
    safeWrite: (_socket: any, data: string) => { written.push(data); },
    reply: (_msg: any, response: object) => JSON.stringify(response) + "\n",
    getAccountName: () => "test-account",
    _written: written,
    _registry: registry,
  } as any;
}

describe("streaming handlers", () => {
  test("subscribe returns error when streaming feature disabled", () => {
    const ctx = createMockContext({ streaming: false });
    const handlers = registerStreamingHandlers(ctx);
    const socket = createMockSocket();

    handlers.subscribe(socket, { type: "subscribe", patterns: ["*"] });

    const written = (ctx as any)._written;
    expect(written.length).toBe(1);
    expect(JSON.parse(written[0]).error).toContain("not enabled");
  });

  test("subscribe registers socket when streaming enabled", () => {
    const ctx = createMockContext({ streaming: true });
    const handlers = registerStreamingHandlers(ctx);
    const socket = createMockSocket();

    handlers.subscribe(socket, { type: "subscribe", patterns: ["AGENT_*"] });

    const registry = (ctx as any)._registry as SubscriptionRegistry;
    expect(registry.getSubscriptionCount()).toBe(1);
  });

  test("subscribe defaults to wildcard when no patterns provided", () => {
    const ctx = createMockContext({ streaming: true });
    const handlers = registerStreamingHandlers(ctx);
    const socket = createMockSocket();

    handlers.subscribe(socket, { type: "subscribe" });

    const written = (ctx as any)._written;
    expect(written.length).toBe(1);
    const result = JSON.parse(written[0]);
    expect(result.subscribed).toBe(true);
    expect(result.patterns).toEqual(["*"]);
  });

  test("unsubscribe returns error when streaming feature disabled", () => {
    const ctx = createMockContext({ streaming: false });
    const handlers = registerStreamingHandlers(ctx);
    const socket = createMockSocket();

    handlers.unsubscribe(socket, { type: "unsubscribe" });

    const written = (ctx as any)._written;
    expect(written.length).toBe(1);
    expect(JSON.parse(written[0]).error).toContain("not enabled");
  });

  test("unsubscribe removes subscription when streaming enabled", () => {
    const ctx = createMockContext({ streaming: true });
    const handlers = registerStreamingHandlers(ctx);
    const socket = createMockSocket();

    handlers.subscribe(socket, { type: "subscribe", patterns: ["*"] });
    const registry = (ctx as any)._registry as SubscriptionRegistry;
    expect(registry.getSubscriptionCount()).toBe(1);

    handlers.unsubscribe(socket, { type: "unsubscribe" });
    expect(registry.getSubscriptionCount()).toBe(0);
  });

  test("unsubscribe with specific patterns only removes those patterns", () => {
    const ctx = createMockContext({ streaming: true });
    const handlers = registerStreamingHandlers(ctx);
    const socket = createMockSocket();

    handlers.subscribe(socket, { type: "subscribe", patterns: ["TASK_*", "AGENT_*"] });
    const registry = (ctx as any)._registry as SubscriptionRegistry;
    expect(registry.getSubscriptionCount()).toBe(1);

    handlers.unsubscribe(socket, { type: "unsubscribe", patterns: ["TASK_*"] });
    expect(registry.getSubscriptionCount()).toBe(1);
  });
});
