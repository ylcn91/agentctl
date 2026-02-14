import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { existsSync } from "fs";
import { getSockPath } from "../paths.js";
import { loadConfig } from "../config.js";
import { useTheme } from "../themes/index.js";

const POLL_INTERVAL_MS = 5_000;

export function StatusBar() {
  const { colors } = useTheme();
  const [daemonUp, setDaemonUp] = useState(false);
  const [accountCount, setAccountCount] = useState(0);

  useEffect(() => {
    function check() {
      setDaemonUp(existsSync(getSockPath()));
    }
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadConfig()
      .then((config) => setAccountCount(config.accounts.length))
      .catch(() => {});
  }, []);

  return (
    <Box
      borderStyle="single"
      borderColor={colors.border}
      paddingX={1}
      marginTop={1}
    >
      <Text color={daemonUp ? colors.success : colors.error}>
        {daemonUp ? "daemon: connected" : "daemon: offline"}
      </Text>
      <Text color={colors.textMuted}> | </Text>
      <Text color={colors.textMuted}>
        accounts: {accountCount}
      </Text>
      <Text color={colors.textMuted}> | </Text>
      <Text color={colors.textMuted}>
        Ctrl+P palette | Ctrl+X t theme | ? help | q quit
      </Text>
    </Box>
  );
}
