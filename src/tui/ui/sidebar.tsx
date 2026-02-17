import { createSignal, createEffect, on, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { useNav } from "../context/nav.js";
import { loadConfig } from "../../config.js";
import { getSockPath } from "../../paths.js";

export function Sidebar() {
  const { colors } = useTheme();
  const route = useRoute();
  const nav = useNav();
  const [daemonStatus, setDaemonStatus] = createSignal("Checking...");
  const [accountCount, setAccountCount] = createSignal(0);
  const [version, setVersion] = createSignal("--");

  createEffect(on(() => nav.sidebarOpen, (visible) => {
    if (!visible) return;

    const sockPath = getSockPath();
    (async () => {
      try {
        const stat = await Bun.file(sockPath).exists();
        setDaemonStatus(stat ? "Connected" : "Offline");
      } catch { setDaemonStatus("Offline"); }
    })();

    loadConfig().then((config) => setAccountCount(config.accounts.length)).catch(() => setAccountCount(0));

    (async () => {
      try {
        const pkg = await Bun.file(new URL("../../../package.json", import.meta.url).pathname).json();
        setVersion(pkg.version ?? "--");
      } catch { setVersion("--"); }
    })();
  }));

  const viewLabel = () => {
    const t = route.data.type;
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  return (
    <Show when={nav.sidebarOpen}>
      <box flexDirection="column" width={32} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={colors.primary}>Info</text>
        <text> </text>
        <text fg={colors.textMuted}>View</text>
        <text attributes={TextAttributes.BOLD}> {viewLabel()}</text>
        <text> </text>
        <text fg={colors.textMuted}>Daemon</text>
        <text attributes={TextAttributes.BOLD} fg={daemonStatus() === "Connected" ? colors.success : colors.error}> {daemonStatus()}</text>
        <text> </text>
        <text fg={colors.textMuted}>Accounts</text>
        <text attributes={TextAttributes.BOLD}> {accountCount()}</text>
        <text> </text>
        <text fg={colors.textMuted}>Version</text>
        <text attributes={TextAttributes.BOLD}> {version()}</text>
      </box>
    </Show>
  );
}
