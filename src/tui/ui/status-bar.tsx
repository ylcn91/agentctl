import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { existsSync } from "fs";
import { getSockPath } from "../../paths.js";
import { loadConfig } from "../../config.js";

const POLL_INTERVAL_MS = 5_000;

export function StatusBar() {
  const { colors } = useTheme();
  const route = useRoute();
  const [daemonUp, setDaemonUp] = createSignal(false);
  const [accountCount, setAccountCount] = createSignal(0);

  onMount(() => {
    function check() { setDaemonUp(existsSync(getSockPath())); }
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    onCleanup(() => clearInterval(interval));
  });

  onMount(() => {
    loadConfig().then((config) => setAccountCount(config.accounts.length)).catch(() => {});
  });

  const isChat = () => route.data.type === "chat";

  return (
    <Show when={!isChat()}>
      <box flexDirection="row" paddingLeft={1} paddingRight={1} marginTop={1}>
        <Show when={daemonUp()}>
          <text fg={colors.success}>{"\u25cf"} daemon</text>
          <text fg={colors.textMuted}> | </text>
        </Show>
        <text fg={colors.textMuted}>accounts: {accountCount()}</text>
        <text fg={colors.textMuted}> | </text>
        <text fg={colors.textMuted}>Ctrl+P palette | Ctrl+X t theme | ? help | q quit</text>
      </box>
    </Show>
  );
}
