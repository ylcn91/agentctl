import { createSignal } from "solid-js";
import { createSimpleContext } from "./helper.js";

export type InputFocus = "global" | "view" | "overlay";

export const { use: useNav, provider: NavProvider } = createSimpleContext({
  name: "Nav",
  init: () => {
    const [globalNavEnabled, setGlobalNavEnabled] = createSignal(true);
    const [refreshTick, setRefreshTick] = createSignal(0);
    const [inputFocus, setInputFocus] = createSignal<InputFocus>("global");
    const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false);
    const [sidebarOpen, setSidebarOpen] = createSignal(false);
    const [helpOpen, setHelpOpen] = createSignal(false);

    return {
      get globalNavEnabled() { return globalNavEnabled(); },
      setGlobalNavEnabled,
      get refreshTick() { return refreshTick(); },
      refresh() { setRefreshTick((t) => t + 1); },
      get inputFocus() { return inputFocus(); },
      setInputFocus,
      get commandPaletteOpen() { return commandPaletteOpen(); },
      toggleCommandPalette() { setCommandPaletteOpen((p) => !p); },
      setCommandPaletteOpen,
      get sidebarOpen() { return sidebarOpen(); },
      toggleSidebar() { setSidebarOpen((p) => !p); },
      get helpOpen() { return helpOpen(); },
      toggleHelp() { setHelpOpen((p) => !p); },
      setHelpOpen,
    };
  },
});
