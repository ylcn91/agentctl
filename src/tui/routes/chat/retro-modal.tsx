
import { createSignal, For, Show, onMount } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../context/theme.js";
import type { AccountConfig } from "../../../types.js";
import type { CouncilController } from "./use-council-state.js";

type Field = "topic" | "members";

interface RetroModalProps {
  accounts: AccountConfig[];
  council: CouncilController;
  onClose: () => void;
}

export function RetroModal(props: RetroModalProps) {
  const { colors } = useTheme();
  const [topic, setTopic] = createSignal("");
  const [selectedMembers, setSelectedMembers] = createSignal<string[]>([]);
  const [activeField, setActiveField] = createSignal<Field>("topic");
  const [memberCursor, setMemberCursor] = createSignal(0);
  const [launching, setLaunching] = createSignal(false);

  onMount(() => {
    const defaults = props.accounts.slice(0, 3).map((a) => a.name);
    setSelectedMembers(defaults);
  });

  function toggleMember(name: string) {
    setSelectedMembers((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  function launch() {
    if (selectedMembers().length < 2) return;
    setLaunching(true);
    const t = topic().trim() || "Sprint Retrospective";
    props.council.startRetroInChat(t);
    setTimeout(() => props.onClose(), 300);
  }

  useKeyboard((evt: any) => {
    if (evt.name === "escape") { props.onClose(); evt.stopPropagation(); return; }

    const field = activeField();

    if (field === "topic") {
      if (evt.name === "return") {
        if (evt.ctrl || evt.meta) { launch(); evt.stopPropagation(); return; }
        setActiveField("members");
        evt.stopPropagation(); return;
      }
      if (evt.name === "down" || evt.name === "tab") {
        setActiveField("members");
        evt.stopPropagation(); return;
      }
      if (evt.name === "backspace") {
        setTopic((p) => p.slice(0, -1));
        evt.stopPropagation(); return;
      }
      if (evt.name === "space") {
        setTopic((p) => p + " ");
        evt.stopPropagation(); return;
      }
      if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta) {
        setTopic((p) => p + evt.name);
        evt.stopPropagation(); return;
      }
      evt.stopPropagation(); return;
    }

    if (field === "members") {
      if (evt.name === "up" || evt.name === "k") {
        if (memberCursor() === 0) { setActiveField("topic"); }
        else { setMemberCursor((p) => p - 1); }
        evt.stopPropagation(); return;
      }
      if (evt.name === "down" || evt.name === "j") {
        setMemberCursor((p) => Math.min(props.accounts.length - 1, p + 1));
        evt.stopPropagation(); return;
      }
      if (evt.name === "tab") {
        setActiveField("topic");
        evt.stopPropagation(); return;
      }
      if (evt.name === "space" || evt.name === "return") {
        if (evt.ctrl && evt.name === "return") { launch(); evt.stopPropagation(); return; }
        const acc = props.accounts[memberCursor()];
        if (acc) toggleMember(acc.name);
        evt.stopPropagation(); return;
      }
      evt.stopPropagation(); return;
    }

    if (evt.ctrl && evt.name === "return") { launch(); evt.stopPropagation(); return; }
  });

  return (
    <box flexDirection="column" paddingX={2} paddingY={1} border={true} borderColor={colors.accent}>
      <text fg={colors.accent} attributes={TextAttributes.BOLD}>Retrospective</text>
      <text fg={colors.textMuted}>Reflect on what went well, what didn't, and action items</text>

      {}
      <box flexDirection="column" marginTop={1}>
        <text fg={activeField() === "topic" ? colors.primary : colors.textMuted} attributes={TextAttributes.BOLD}>
          Topic (optional)
        </text>
        <box flexDirection="row" border={activeField() === "topic" ? ["left"] : undefined} borderColor={colors.primary} paddingLeft={1}>
          <text fg={colors.text}>{topic() || ""}</text>
          <Show when={activeField() === "topic"}>
            <text fg={colors.primary}>{"\u2588"}</text>
          </Show>
          <Show when={!topic() && activeField() === "topic"}>
            <text fg={colors.textMuted}> Sprint Retrospective (default)</text>
          </Show>
        </box>
      </box>

      {}
      <box flexDirection="column" marginTop={1}>
        <text fg={activeField() === "members" ? colors.primary : colors.textMuted} attributes={TextAttributes.BOLD}>
          Participants ({selectedMembers().length})
        </text>
        <For each={props.accounts}>
          {(acc, idx) => {
            const isChecked = () => selectedMembers().includes(acc.name);
            const isCursor = () => activeField() === "members" && idx() === memberCursor();
            return (
              <box flexDirection="row" paddingLeft={1}>
                <text fg={isCursor() ? colors.primary : colors.textMuted}>
                  {isCursor() ? "> " : "  "}
                </text>
                <text fg={isChecked() ? colors.success : colors.textMuted}>
                  {isChecked() ? "[\u2713] " : "[ ] "}
                </text>
                <text fg={isCursor() ? colors.text : colors.textMuted}>
                  {acc.label || acc.name}
                </text>
              </box>
            );
          }}
        </For>
      </box>

      {}
      <box flexDirection="row" marginTop={1}>
        <Show when={launching()}>
          <text fg={colors.success} attributes={TextAttributes.BOLD}>Launching retro...</text>
        </Show>
        <Show when={!launching()}>
          <Show when={selectedMembers().length >= 2}>
            <text fg={colors.success}>Ctrl+Enter to launch</text>
          </Show>
          <Show when={selectedMembers().length < 2}>
            <text fg={colors.warning}>Select at least 2 participants</text>
          </Show>
          <text fg={colors.textMuted}>{"  Tab next field  Esc cancel"}</text>
        </Show>
      </box>
    </box>
  );
}
