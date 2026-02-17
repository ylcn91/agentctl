import { createStore } from "solid-js/store";
import { createSimpleContext } from "./helper.js";
import { useKV } from "./kv.js";

export type SimpleViewType =
  | "dashboard" | "chat" | "tasks" | "inbox" | "launcher" | "usage"
  | "add" | "sla" | "prompts" | "analytics" | "workflows" | "health"
  | "council" | "verify" | "entire" | "chains" | "streams" | "tdd" | "theme" | "wizard";

export type Route =
  | { type: SimpleViewType }
  | { type: "workflow_detail"; runId: string };

const VALID_VIEWS = new Set<string>([
  "dashboard", "chat", "tasks", "inbox", "launcher", "usage", "add",
  "sla", "prompts", "analytics", "workflows", "workflow_detail",
  "health", "council", "verify", "entire", "chains", "streams", "tdd", "theme", "wizard",
]);

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const kv = useKV();
    const persisted = kv.get("lastView") as string | undefined;
    const initial: Route =
      persisted && VALID_VIEWS.has(persisted) && persisted !== "workflow_detail"
        ? { type: persisted as SimpleViewType }
        : { type: "chat" };
    const [store, setStore] = createStore<Route>(initial);

    return {
      get data() { return store; },
      navigate(route: Route) {
        setStore(route);
        kv.set("lastView", route.type);
      },
    };
  },
});

export type RouteContext = ReturnType<typeof useRoute>;
