import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { useNav } from "../context/nav.js";
import { Spinner } from "../ui/spinner.js";
import { CATPPUCCIN_COLORS, setupAccount, addShellAlias } from "../../services/account-manager.js";

type Step = "name" | "dir" | "color" | "label" | "options" | "confirm" | "running" | "done" | "error";

const colorItems = CATPPUCCIN_COLORS.map((c) => ({ label: `${c.name} (${c.hex})`, value: c.hex }));
const optionItems = [
  { label: "Symlink plugins, skills, commands from ~/.claude", value: "symlinks" },
  { label: "Add shell alias (claude-<name>)", value: "alias" },
  { label: "Both", value: "both" },
  { label: "Skip", value: "skip" },
];

export function AddAccount() {
  const { colors } = useTheme();
  const route = useRoute();
  const nav = useNav();
  const [step, setStep] = createSignal<Step>("name");
  const [name, setName] = createSignal("");
  const [dir, setDir] = createSignal("");
  const [color, setColor] = createSignal("");
  const [label, setLabel] = createSignal("");
  const [setupOpt, setSetupOpt] = createSignal("both");
  const [result, setResult] = createSignal("");
  const [error, setError] = createSignal("");
  const [colorIndex, setColorIndex] = createSignal(0);
  const [optionIndex, setOptionIndex] = createSignal(0);

  onMount(() => { nav.setInputFocus("view"); });
  onCleanup(() => { nav.setInputFocus("global"); });

  async function handleConfirm() {
    setStep("running");
    try {
      const doSymlinks = setupOpt() === "symlinks" || setupOpt() === "both";
      const doAlias = setupOpt() === "alias" || setupOpt() === "both";

      const { account, tokenPath } = await setupAccount({
        name: name(), configDir: dir(), color: color(), label: label(),
        symlinkPlugins: doSymlinks, symlinkSkills: doSymlinks, symlinkCommands: doSymlinks,
      });

      let msg = `Account '${name()}' created.\nConfig dir: ${dir()}\nToken: ${tokenPath}`;
      if (doAlias) {
        const aliasResult = await addShellAlias(name(), dir());
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
  }

  useKeyboard((evt: any) => {
    if (nav.inputFocus !== "view") return;
    const s = step();

    if (s === "done" || s === "error") {
      route.navigate({ type: "dashboard" });
      nav.setInputFocus("global");
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "name") {
      if (evt.name === "return" && name().trim()) {
        const n = name().trim();
        setDir(`~/.claude-${n}`);
        setLabel(n.charAt(0).toUpperCase() + n.slice(1));
        setStep("dir");
      } else if (evt.name === "backspace") {
        setName((p) => p.slice(0, -1));
      } else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) {
        setName((p) => p + evt.name);
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "dir") {
      if (evt.name === "return") { setStep("label"); }
      else if (evt.name === "backspace") { setDir((p) => p.slice(0, -1)); }
      else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) { setDir((p) => p + evt.name); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "label") {
      if (evt.name === "return") { setStep("color"); }
      else if (evt.name === "backspace") { setLabel((p) => p.slice(0, -1)); }
      else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) { setLabel((p) => p + evt.name); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "color") {
      if (evt.name === "up" || evt.name === "k") { setColorIndex((i) => Math.max(0, i - 1)); }
      else if (evt.name === "down" || evt.name === "j") { setColorIndex((i) => Math.min(colorItems.length - 1, i + 1)); }
      else if (evt.name === "return") { setColor(colorItems[colorIndex()].value); setStep("options"); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "options") {
      if (evt.name === "up" || evt.name === "k") { setOptionIndex((i) => Math.max(0, i - 1)); }
      else if (evt.name === "down" || evt.name === "j") { setOptionIndex((i) => Math.min(optionItems.length - 1, i + 1)); }
      else if (evt.name === "return") { setSetupOpt(optionItems[optionIndex()].value); setStep("confirm"); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "confirm") {
      if (evt.name === "return") { handleConfirm(); }
      else if (evt.name === "q" || evt.name === "escape") { route.navigate({ type: "dashboard" }); nav.setInputFocus("global"); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }
  });

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <text attributes={TextAttributes.BOLD} fg={colors.secondary}>Add Account</text>

      <Show when={step() === "name"}>
        <box flexDirection="column">
          <text>Account name (lowercase, no spaces):</text>
          <box><text>{name()}</text><text fg={colors.textMuted}>_</text></box>
        </box>
      </Show>

      <Show when={step() === "dir"}>
        <box flexDirection="column">
          <text>Config directory:</text>
          <box><text>{dir()}</text><text fg={colors.textMuted}>_</text></box>
        </box>
      </Show>

      <Show when={step() === "label"}>
        <box flexDirection="column">
          <text>Display label:</text>
          <box><text>{label()}</text><text fg={colors.textMuted}>_</text></box>
        </box>
      </Show>

      <Show when={step() === "color"}>
        <box flexDirection="column">
          <text>Choose a color:</text>
          <For each={colorItems}>
            {(c, idx) => (
              <box marginLeft={1}>
                <text fg={idx() === colorIndex() ? colors.primary : colors.textMuted}>
                  {idx() === colorIndex() ? "> " : "  "}{c.label}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={step() === "options"}>
        <box flexDirection="column">
          <text>Setup options:</text>
          <For each={optionItems}>
            {(opt, idx) => (
              <box marginLeft={1}>
                <text fg={idx() === optionIndex() ? colors.primary : colors.textMuted}>
                  {idx() === optionIndex() ? "> " : "  "}{opt.label}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={step() === "confirm"}>
        <box flexDirection="column">
          <text>Ready to create account:</text>
          <text>  Name: <text attributes={TextAttributes.BOLD}>{name()}</text></text>
          <text>  Dir: <text attributes={TextAttributes.BOLD}>{dir()}</text></text>
          <text>  Label: <text attributes={TextAttributes.BOLD}>{label()}</text></text>
          <text>  Color: <text attributes={TextAttributes.BOLD} fg={color()}>{color()}</text></text>
          <text>  Options: <text attributes={TextAttributes.BOLD}>{setupOpt()}</text></text>
          <text fg={colors.textMuted}>Press Enter to confirm, or q to cancel.</text>
        </box>
      </Show>

      <Show when={step() === "running"}>
        <box><Spinner label="Setting up account..." /></box>
      </Show>

      <Show when={step() === "done"}>
        <box flexDirection="column">
          <text fg={colors.success}>Done!</text>
          <text>{result()}</text>
          <text fg={colors.textMuted}>Press any key to return.</text>
        </box>
      </Show>

      <Show when={step() === "error"}>
        <box flexDirection="column">
          <text fg={colors.error}>Error: {error()}</text>
          <text fg={colors.textMuted}>Press any key to return.</text>
        </box>
      </Show>
    </box>
  );
}
