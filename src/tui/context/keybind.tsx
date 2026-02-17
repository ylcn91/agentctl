import { useKeyboard } from "@opentui/solid";
import { createStore } from "solid-js/store";
import { createSimpleContext } from "./helper.js";
import { useRoute, type Route } from "./route.js";
import { useNav } from "./nav.js";
import { useExit } from "./exit.js";

const NAV_KEYS: Record<string, Route["type"]> = {
  d: "dashboard",
  l: "launcher",
  u: "usage",
  t: "tasks",
  m: "inbox",
  a: "add",
  e: "sla",
  r: "prompts",
  n: "analytics",
  w: "workflows",
  h: "health",
  c: "council",
  v: "verify",
  i: "entire",
  g: "chains",
  s: "streams",
  x: "chat",
};

export { NAV_KEYS };

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const route = useRoute();
    const nav = useNav();
    const exit = useExit();
    const [store, setStore] = createStore({ leader: false });
    let leaderTimer: ReturnType<typeof setTimeout> | null = null;

    function clearLeader() {
      setStore("leader", false);
      if (leaderTimer) { clearTimeout(leaderTimer); leaderTimer = null; }
    }

    useKeyboard((evt: any) => {
      if (evt.ctrl && evt.name === "c") {
        exit();
        return;
      }

      if (evt.defaultPrevented) return;

      if (evt.ctrl && evt.name === "p") {
        nav.toggleCommandPalette();
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }

      if (nav.commandPaletteOpen) return;

      if (evt.ctrl && evt.name === "x") {
        setStore("leader", true);
        if (leaderTimer) clearTimeout(leaderTimer);
        leaderTimer = setTimeout(clearLeader, 500);
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }

      if (store.leader && evt.name) {
        clearLeader();
        if (evt.name === "b") { nav.toggleSidebar(); evt.preventDefault(); evt.stopPropagation(); return; }
        if (evt.name === "p") { nav.toggleCommandPalette(); evt.preventDefault(); evt.stopPropagation(); return; }
        if (evt.name === "t") { route.navigate({ type: "theme" }); evt.preventDefault(); evt.stopPropagation(); return; }
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }

      if (evt.ctrl && evt.name === "r") {
        nav.refresh();
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }

      if (nav.inputFocus !== "global") return;

      if (evt.name === "?") {
        nav.toggleHelp();
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }

      if (evt.name === "q" && nav.globalNavEnabled) {
        exit();
        return;
      }

      if (!nav.globalNavEnabled) return;

      if (evt.name === "escape") {
        route.navigate({ type: "dashboard" });
        nav.setGlobalNavEnabled(true);
        nav.setHelpOpen(false);
        nav.setCommandPaletteOpen(false);
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }

      const target = NAV_KEYS[evt.name as string];
      if (target && target !== route.data.type) {
        route.navigate({ type: target } as Route);
        evt.preventDefault();
        evt.stopPropagation();
      }
    });

    return {
      get leader() { return store.leader; },
      NAV_KEYS,
    };
  },
});
