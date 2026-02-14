import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { loadConfig } from "../config.js";
import { getEntireCheckpoints, isEntireInstalled } from "../services/entire.js";
import { launchAccount } from "../application/use-cases/launch-account.js";
import { useTheme } from "../themes/index.js";
import type { AccountConfig } from "../types.js";
import type { EntireCheckpoint } from "../services/entire.js";

type Step = "account" | "directory" | "options" | "checkpoint" | "launching";

interface LaunchOptions {
  resume: boolean;
  newWindow: boolean;
  autoEntire: boolean;
  bypassPermissions: boolean;
}

interface Props {
  onNavigate: (view: string) => void;
}

export function Launcher({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>("account");
  const [accounts, setAccounts] = useState<AccountConfig[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountConfig | null>(null);
  const [directory, setDirectory] = useState(process.cwd());
  const [options, setOptions] = useState<LaunchOptions>({
    resume: false,
    newWindow: true,
    autoEntire: true,
    bypassPermissions: false,
  });
  const [optionIndex, setOptionIndex] = useState(0);
  const [checkpoints, setCheckpoints] = useState<EntireCheckpoint[]>([]);
  const [entireAvailable, setEntireAvailable] = useState(false);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null);
  const [launchStatus, setLaunchStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const config = await loadConfig();
        setAccounts(config.accounts);
        const installed = await isEntireInstalled();
        setEntireAvailable(installed);
      } catch (e: any) {
        setError(e.message);
      }
    }
    load();
  }, []);

  // Load checkpoints when directory changes and account is selected
  useEffect(() => {
    if (!selectedAccount || !directory) return;
    getEntireCheckpoints(directory).then(setCheckpoints).catch(() => setCheckpoints([]));
  }, [directory, selectedAccount]);

  useInput((input, key) => {
    if (key.escape) {
      if (step === "account") {
        onNavigate("dashboard");
      } else if (step === "directory") {
        setStep("account");
      } else if (step === "options") {
        setStep("directory");
      } else if (step === "checkpoint") {
        setSelectedCheckpointId(null);
        setStep("options");
      }
      return;
    }

    if (step === "options") {
      if (key.upArrow) {
        setOptionIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setOptionIndex((i) => Math.min(3, i + 1));
      } else if (input === " ") {
        setOptions((prev) => {
          const keys: (keyof LaunchOptions)[] = ["resume", "newWindow", "autoEntire", "bypassPermissions"];
          const key = keys[optionIndex];
          return { ...prev, [key]: !prev[key] };
        });
      } else if (key.return) {
        if (options.resume && checkpoints.length > 0) {
          setStep("checkpoint");
        } else {
          doLaunch();
        }
      }
    }
  });

  function handleAccountSelect(item: { value: string }) {
    const account = accounts.find((a) => a.name === item.value);
    if (account) {
      setSelectedAccount(account);
      setStep("directory");
    }
  }

  function handleDirectorySubmit(value: string) {
    setDirectory(value);
    setStep("options");
  }

  function handleCheckpointSelect(item: { value: string }) {
    setSelectedCheckpointId(item.value);
    doLaunch(item.value);
  }

  async function doLaunch(checkpointId?: string) {
    if (!selectedAccount) return;
    setStep("launching");

    const result = await launchAccount(selectedAccount.name, {
      dir: directory,
      resume: options.resume,
      bypassPermissions: options.bypassPermissions,
      noEntire: !options.autoEntire,
      noWindow: !options.newWindow,
      checkpointId: checkpointId ?? selectedCheckpointId ?? undefined,
      onStatus: setLaunchStatus,
    });

    if (result.success) {
      if (options.newWindow && result.terminalName) {
        setLaunchStatus(`Launched ${selectedAccount.name} in ${result.terminalName}`);
      } else {
        setLaunchStatus(`Run manually: ${result.shellCmd}`);
      }
    } else {
      setLaunchStatus(result.error ?? "Launch failed");
    }
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={colors.error}>Error: {error}</Text>
        <Text color={colors.textMuted}>[Esc] Back</Text>
      </Box>
    );
  }

  if (step === "account") {
    if (accounts.length === 0) {
      return (
        <Box flexDirection="column" paddingY={1}>
          <Text color={colors.textMuted}>No accounts configured. Press [a] to add one.</Text>
          <Text color={colors.textMuted}>[Esc] Back</Text>
        </Box>
      );
    }

    const items = accounts.map((a) => ({
      label: `${a.name} (${a.label})`,
      value: a.name,
    }));

    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Select account:</Text>
        <SelectInput items={items} onSelect={handleAccountSelect} />
        <Text color={colors.textMuted}>[Esc] Back</Text>
      </Box>
    );
  }

  if (step === "directory") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>
          Launching: <Text color={selectedAccount?.color}>{selectedAccount?.name}</Text>
        </Text>
        <Box>
          <Text>Directory: </Text>
          <TextInput value={directory} onChange={setDirectory} onSubmit={handleDirectorySubmit} />
        </Box>
        <Text color={colors.textMuted}>[Enter] Confirm  [Esc] Back</Text>
      </Box>
    );
  }

  if (step === "options") {
    const optionsList: { key: keyof LaunchOptions; label: string }[] = [
      { key: "resume", label: "Resume last session" },
      { key: "newWindow", label: "Open in new terminal window" },
      { key: "autoEntire", label: "Auto-enable Entire (if git repo)" },
      { key: "bypassPermissions", label: "Bypass permissions (--dangerously-skip-permissions)" },
    ];

    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>
          Launching: <Text color={selectedAccount?.color}>{selectedAccount?.name}</Text>
          {" "}in {directory}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Options:</Text>
          {optionsList.map((opt, i) => (
            <Box key={opt.key}>
              <Text color={i === optionIndex ? colors.primary : undefined}>
                {i === optionIndex ? "> " : "  "}
                [{options[opt.key] ? "x" : " "}] {opt.label}
                {opt.key === "autoEntire" && !entireAvailable ? (
                  <Text color={colors.textMuted}> (not installed)</Text>
                ) : null}
              </Text>
            </Box>
          ))}
        </Box>
        {checkpoints.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Entire checkpoints:</Text>
            {checkpoints.slice(0, 5).map((cp) => (
              <Box key={cp.checkpointId} marginLeft={2}>
                <Text color={colors.textMuted}>
                  {cp.checkpointId.slice(0, 8)} | {cp.branch} |{" "}
                  {cp.filesTouched.length} files
                </Text>
              </Box>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={colors.textMuted}>[Space] Toggle  [Enter] Launch  [Esc] Back</Text>
        </Box>
      </Box>
    );
  }

  if (step === "checkpoint") {
    const items = checkpoints.map((cp) => {
      const time = cp.createdAt ? new Date(cp.createdAt).toLocaleString() : "unknown";
      return {
        label: `${cp.checkpointId.slice(0, 8)} | ${cp.branch} | ${cp.filesTouched.length} files | ${time}`,
        value: cp.checkpointId,
      };
    });

    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Select checkpoint to resume:</Text>
        <SelectInput items={items} onSelect={handleCheckpointSelect} />
        <Text color={colors.textMuted}>[Enter] Select  [Esc] Back</Text>
      </Box>
    );
  }

  // Launching step
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color={colors.success}>{launchStatus || "Launching..."}</Text>
      <Text color={colors.textMuted}>[Esc] Back to dashboard</Text>
    </Box>
  );
}
