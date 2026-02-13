import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { CATPPUCCIN_COLORS, setupAccount, addShellAlias } from "../services/account-manager.js";

type Step = "name" | "dir" | "color" | "label" | "options" | "confirm" | "running" | "done" | "error";

interface Props {
  onDone: () => void;
  configPath?: string;
}

const colorItems = CATPPUCCIN_COLORS.map((c) => ({
  label: `${c.name} (${c.hex})`,
  value: c.hex,
}));

const optionItems = [
  { label: "Symlink plugins, skills, commands from ~/.claude", value: "symlinks" },
  { label: "Add shell alias (claude-<name>)", value: "alias" },
  { label: "Both", value: "both" },
  { label: "Skip", value: "skip" },
];

export function AddAccount({ onDone, configPath }: Props) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [color, setColor] = useState("");
  const [label, setLabel] = useState("");
  const [setupOpt, setSetupOpt] = useState("both");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  useInput((input) => {
    if (step === "done" || step === "error") {
      onDone();
    }
  });

  const handleNameSubmit = (value: string) => {
    setName(value.trim());
    setDir(`~/.claude-${value.trim()}`);
    setLabel(value.trim().charAt(0).toUpperCase() + value.trim().slice(1));
    setStep("dir");
  };

  const handleDirSubmit = (value: string) => {
    setDir(value.trim());
    setStep("label");
  };

  const handleLabelSubmit = (value: string) => {
    setLabel(value.trim());
    setStep("color");
  };

  const handleColorSelect = (item: { value: string }) => {
    setColor(item.value);
    setStep("options");
  };

  const handleOptionSelect = (item: { value: string }) => {
    setSetupOpt(item.value);
    setStep("confirm");
  };

  const handleConfirm = async () => {
    setStep("running");
    try {
      const doSymlinks = setupOpt === "symlinks" || setupOpt === "both";
      const doAlias = setupOpt === "alias" || setupOpt === "both";

      const { account, tokenPath } = await setupAccount({
        name,
        configDir: dir,
        color,
        label,
        symlinkPlugins: doSymlinks,
        symlinkSkills: doSymlinks,
        symlinkCommands: doSymlinks,
        configPath,
      });

      let msg = `Account '${name}' created.\nConfig dir: ${dir}\nToken: ${tokenPath}`;

      if (doAlias) {
        const aliasResult = await addShellAlias(name, dir);
        if (aliasResult.modified) {
          msg += `\nShell alias added to .zshrc`;
          if (aliasResult.backupPath) msg += ` (backup: ${aliasResult.backupPath})`;
        } else {
          msg += `\nShell alias already exists`;
        }
      }

      setResult(msg);
      setStep("done");
    } catch (e: any) {
      setError(e.message);
      setStep("error");
    }
  };

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold color="magenta">Add Account</Text>

      {step === "name" && (
        <Box flexDirection="column">
          <Text>Account name (lowercase, no spaces):</Text>
          <TextInput value={name} onChange={setName} onSubmit={handleNameSubmit} />
        </Box>
      )}

      {step === "dir" && (
        <Box flexDirection="column">
          <Text>Config directory:</Text>
          <TextInput value={dir} onChange={setDir} onSubmit={handleDirSubmit} />
        </Box>
      )}

      {step === "label" && (
        <Box flexDirection="column">
          <Text>Display label:</Text>
          <TextInput value={label} onChange={setLabel} onSubmit={handleLabelSubmit} />
        </Box>
      )}

      {step === "color" && (
        <Box flexDirection="column">
          <Text>Choose a color:</Text>
          <SelectInput items={colorItems} onSelect={handleColorSelect} />
        </Box>
      )}

      {step === "options" && (
        <Box flexDirection="column">
          <Text>Setup options:</Text>
          <SelectInput items={optionItems} onSelect={handleOptionSelect} />
        </Box>
      )}

      {step === "confirm" && (
        <Box flexDirection="column">
          <Text>Ready to create account:</Text>
          <Text>  Name: <Text bold>{name}</Text></Text>
          <Text>  Dir: <Text bold>{dir}</Text></Text>
          <Text>  Label: <Text bold>{label}</Text></Text>
          <Text>  Color: <Text bold color={color}>{color}</Text></Text>
          <Text>  Options: <Text bold>{setupOpt}</Text></Text>
          <Text color="gray">Press Enter to confirm, or q to cancel.</Text>
          <TextInput value="" onChange={() => {}} onSubmit={handleConfirm} />
        </Box>
      )}

      {step === "running" && (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Setting up account...</Text>
        </Box>
      )}

      {step === "done" && (
        <Box flexDirection="column">
          <Text color="green">Done!</Text>
          <Text>{result}</Text>
          <Text color="gray">Press any key to return.</Text>
        </Box>
      )}

      {step === "error" && (
        <Box flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Text color="gray">Press any key to return.</Text>
        </Box>
      )}
    </Box>
  );
}
