import { createSignal, createEffect, on, onMount, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { useNav } from "../context/nav.js";
import { loadConfig } from "../../config.js";
import { getEntireCheckpoints, isEntireInstalled } from "../../services/entire.js";
import { launchAccount } from "../../application/use-cases/launch-account.js";
import type { AccountConfig } from "../../types.js";

type Step = "account" | "directory" | "options" | "checkpoint" | "launching";

interface LaunchOptions {
  resume: boolean;
  newWindow: boolean;
  autoEntire: boolean;
  bypassPermissions: boolean;
}

export function Launcher() {
  const { colors } = useTheme();
  const route = useRoute();
  const nav = useNav();
  const [step, setStep] = createSignal<Step>("account");
  const [accounts, setAccounts] = createSignal<AccountConfig[]>([]);
  const [selectedAccount, setSelectedAccount] = createSignal<AccountConfig | null>(null);
  const [directory, setDirectory] = createSignal(process.cwd());
  const [options, setOptions] = createSignal<LaunchOptions>({
    resume: false, newWindow: true, autoEntire: true, bypassPermissions: false,
  });
  const [optionIndex, setOptionIndex] = createSignal(0);
  const [accountIndex, setAccountIndex] = createSignal(0);
  const [checkpoints, setCheckpoints] = createSignal<any[]>([]);
  const [checkpointIndex, setCheckpointIndex] = createSignal(0);
  const [entireAvailable, setEntireAvailable] = createSignal(false);
  const [launchStatus, setLaunchStatus] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [dirInput, setDirInput] = createSignal(process.cwd());

  onMount(async () => {
    nav.setInputFocus("view");
    try {
      const config = await loadConfig();
      setAccounts(config.accounts);
      const installed = await isEntireInstalled();
      setEntireAvailable(installed);
    } catch (e: any) {
      setError(e.message);
    }
  });

  createEffect(on(() => [selectedAccount(), directory()] as const, ([acct, dir]) => {
    if (!acct || !dir) return;
    getEntireCheckpoints(dir).then(setCheckpoints).catch(() => setCheckpoints([]));
  }));

  async function doLaunch(checkpointId?: string) {
    const acct = selectedAccount();
    if (!acct) return;
    setStep("launching");
    const opts = options();
    const result = await launchAccount(acct.name, {
      dir: directory(),
      resume: opts.resume,
      bypassPermissions: opts.bypassPermissions,
      noEntire: !opts.autoEntire,
      noWindow: !opts.newWindow,
      checkpointId,
      onStatus: setLaunchStatus,
    });
    if (result.success) {
      setLaunchStatus(opts.newWindow && result.terminalName
        ? `Launched ${acct.name} in ${result.terminalName}`
        : `Run manually: ${result.shellCmd}`);
    } else {
      setLaunchStatus(result.error ?? "Launch failed");
    }
  }

  useKeyboard((evt: any) => {
    if (nav.inputFocus !== "view") return;
    const s = step();

    if (evt.name === "escape") {
      if (s === "account") { route.navigate({ type: "dashboard" }); nav.setInputFocus("global"); }
      else if (s === "directory") setStep("account");
      else if (s === "options") setStep("directory");
      else if (s === "checkpoint") setStep("options");
      else if (s === "launching") { route.navigate({ type: "dashboard" }); nav.setInputFocus("global"); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "account") {
      const accts = accounts();
      if (evt.name === "up" || evt.name === "k") { setAccountIndex((i) => Math.max(0, i - 1)); }
      else if (evt.name === "down" || evt.name === "j") { setAccountIndex((i) => Math.min(accts.length - 1, i + 1)); }
      else if (evt.name === "return" && accts[accountIndex()]) {
        setSelectedAccount(accts[accountIndex()]);
        setDirInput(process.cwd());
        setStep("directory");
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "directory") {
      if (evt.name === "return") {
        setDirectory(dirInput());
        setStep("options");
      } else if (evt.name === "backspace") {
        setDirInput((p) => p.slice(0, -1));
      } else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) {
        setDirInput((p) => p + evt.name);
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "options") {
      if (evt.name === "up") { setOptionIndex((i) => Math.max(0, i - 1)); }
      else if (evt.name === "down") { setOptionIndex((i) => Math.min(3, i + 1)); }
      else if (evt.name === " ") {
        const keys: (keyof LaunchOptions)[] = ["resume", "newWindow", "autoEntire", "bypassPermissions"];
        const key = keys[optionIndex()];
        setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
      } else if (evt.name === "return") {
        if (options().resume && checkpoints().length > 0) setStep("checkpoint");
        else doLaunch();
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (s === "checkpoint") {
      const cps = checkpoints();
      if (evt.name === "up" || evt.name === "k") { setCheckpointIndex((i) => Math.max(0, i - 1)); }
      else if (evt.name === "down" || evt.name === "j") { setCheckpointIndex((i) => Math.min(cps.length - 1, i + 1)); }
      else if (evt.name === "return" && cps[checkpointIndex()]) {
        doLaunch(cps[checkpointIndex()].checkpointId);
      }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }
  });

  return (
    <Show when={!error()} fallback={
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <text fg={colors.error}>Error: {error()}</text>
        <text fg={colors.textMuted}>[Esc] Back</text>
      </box>
    }>
      <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingX={1}>
        <Show when={step() === "account"}>
          <Show when={accounts().length === 0} fallback={
            <box flexDirection="column">
              <text attributes={TextAttributes.BOLD}>Select account:</text>
              <For each={accounts()}>
                {(a, idx) => (
                  <box marginLeft={1}>
                    <text fg={idx() === accountIndex() ? colors.primary : colors.textMuted}>
                      {idx() === accountIndex() ? "> " : "  "}
                    </text>
                    <text fg={idx() === accountIndex() ? colors.text : colors.textMuted}>
                      {a.name} ({a.label})
                    </text>
                  </box>
                )}
              </For>
              <text fg={colors.textMuted}>[Enter] Select  [Esc] Back</text>
            </box>
          }>
            <text fg={colors.textMuted}>No accounts configured. Press [a] to add one.</text>
            <text fg={colors.textMuted}>[Esc] Back</text>
          </Show>
        </Show>

        <Show when={step() === "directory"}>
          <text attributes={TextAttributes.BOLD}>Launching: <text fg={selectedAccount()?.color}>{selectedAccount()?.name}</text></text>
          <box>
            <text>Directory: </text>
            <text>{dirInput()}</text>
            <text fg={colors.textMuted}>_</text>
          </box>
          <text fg={colors.textMuted}>[Enter] Confirm  [Esc] Back</text>
        </Show>

        <Show when={step() === "options"}>
          <text attributes={TextAttributes.BOLD}>Launching: <text fg={selectedAccount()?.color}>{selectedAccount()?.name}</text> in {directory()}</text>
          <box marginTop={1} flexDirection="column">
            <text attributes={TextAttributes.BOLD}>Options:</text>
            <For each={[
              { key: "resume" as keyof LaunchOptions, label: "Resume last session" },
              { key: "newWindow" as keyof LaunchOptions, label: "Open in new terminal window" },
              { key: "autoEntire" as keyof LaunchOptions, label: "Auto-enable Entire (if git repo)" },
              { key: "bypassPermissions" as keyof LaunchOptions, label: "Bypass permissions (--dangerously-skip-permissions)" },
            ]}>
              {(opt, i) => (
                <box paddingLeft={1}>
                  <text fg={i() === optionIndex() ? colors.primary : undefined}>
                    {i() === optionIndex() ? "> " : "  "}[{options()[opt.key] ? "x" : " "}] {opt.label}
                  </text>
                  <Show when={opt.key === "autoEntire" && !entireAvailable()}>
                    <text fg={colors.textMuted}> (not installed)</text>
                  </Show>
                </box>
              )}
            </For>
          </box>
          <box marginTop={1}><text fg={colors.textMuted}>[Space] Toggle  [Enter] Launch  [Esc] Back</text></box>
        </Show>

        <Show when={step() === "checkpoint"}>
          <text attributes={TextAttributes.BOLD}>Select checkpoint to resume:</text>
          <For each={checkpoints()}>
            {(cp, idx) => (
              <box marginLeft={1}>
                <text fg={idx() === checkpointIndex() ? colors.primary : colors.textMuted}>
                  {idx() === checkpointIndex() ? "> " : "  "}
                  {cp.checkpointId.slice(0, 8)} | {cp.branch} | {cp.filesTouched.length} files
                </text>
              </box>
            )}
          </For>
          <text fg={colors.textMuted}>[Enter] Select  [Esc] Back</text>
        </Show>

        <Show when={step() === "launching"}>
          <text fg={colors.success}>{launchStatus() || "Launching..."}</text>
          <text fg={colors.textMuted}>[Esc] Back to dashboard</text>
        </Show>
      </box>
    </Show>
  );
}
