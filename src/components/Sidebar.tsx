import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { loadConfig } from "../config.js";
import { getSockPath } from "../paths.js";
import { useTheme } from "../themes/index.js";

interface Props {
  visible: boolean;
  currentView: string;
}

export function Sidebar({ visible, currentView }: Props) {
  const { colors } = useTheme();
  const [daemonStatus, setDaemonStatus] = useState("Checking...");
  const [accountCount, setAccountCount] = useState(0);
  const [version, setVersion] = useState("--");

  useEffect(() => {
    if (!visible) return;

    // Check daemon status by attempting to connect to the socket
    const sockPath = getSockPath();
    (async () => {
      try {
        const stat = await Bun.file(sockPath).exists();
        setDaemonStatus(stat ? "Connected" : "Offline");
      } catch {
        setDaemonStatus("Offline");
      }
    })();

    // Load account count
    loadConfig()
      .then((config) => setAccountCount(config.accounts.length))
      .catch(() => setAccountCount(0));

    // Read version from package.json
    (async () => {
      try {
        const pkg = await Bun.file(
          new URL("../../package.json", import.meta.url).pathname
        ).json();
        setVersion(pkg.version ?? "--");
      } catch {
        setVersion("--");
      }
    })();
  }, [visible]);

  if (!visible) return null;

  const viewLabel = currentView.charAt(0).toUpperCase() + currentView.slice(1);

  return (
    <Box
      flexDirection="column"
      width={32}
      borderStyle="single"
      borderColor={colors.border}
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      paddingX={1}
      paddingY={1}
    >
      <Text bold color={colors.primary}>Info</Text>
      <Text> </Text>

      <Text color={colors.textMuted}>View</Text>
      <Text bold> {viewLabel}</Text>
      <Text> </Text>

      <Text color={colors.textMuted}>Daemon</Text>
      <Text bold color={daemonStatus === "Connected" ? colors.success : colors.error}>
        {" "}{daemonStatus}
      </Text>
      <Text> </Text>

      <Text color={colors.textMuted}>Accounts</Text>
      <Text bold> {accountCount}</Text>
      <Text> </Text>

      <Text color={colors.textMuted}>Version</Text>
      <Text bold> {version}</Text>
    </Box>
  );
}
