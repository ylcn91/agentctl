import type { Socket } from "net";
import type { HandlerContext, HandlerFn } from "../handler-types";

export function registerStreamingHandlers(ctx: HandlerContext): Record<string, HandlerFn> {
  const { state, features, safeWrite, reply, getAccountName } = ctx;

  return {
    subscribe: (socket: Socket, msg: any) => {
      if (!features?.streaming) {
        safeWrite(socket, reply(msg, { type: "error", error: "Streaming feature not enabled" }));
        return;
      }
      const patterns = Array.isArray(msg.patterns) ? msg.patterns : ["*"];
      const account = getAccountName(socket);
      state.subscriptionRegistry.subscribe(socket, account, patterns);
      safeWrite(socket, reply(msg, { type: "result", subscribed: true, patterns }));
    },

    unsubscribe: (socket: Socket, msg: any) => {
      if (!features?.streaming) {
        safeWrite(socket, reply(msg, { type: "error", error: "Streaming feature not enabled" }));
        return;
      }
      const patterns = Array.isArray(msg.patterns) ? msg.patterns : undefined;
      state.subscriptionRegistry.unsubscribe(socket, patterns);
      safeWrite(socket, reply(msg, { type: "result", unsubscribed: true }));
    },
  };
}
