
import { createSignal, For, Show, onMount } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../context/theme.js";
import { loadConfig } from "../../../config.js";
import type { AccountConfig } from "../../../types.js";
import type { CouncilController } from "./use-council-state.js";

type CouncilMode = "discussion" | "analysis";
type Field = "topic" | "members" | "chairman" | "mode";

interface CouncilModalProps {
  accounts: AccountConfig[];
  council: CouncilController;
  onClose: () => void;
}

export function CouncilModal(props: CouncilModalProps) {
  const { colors } = useTheme();
  const [topic, setTopic] = createSignal("");
  const [selectedMembers, setSelectedMembers] = createSignal<string[]>([]);
  const [chairman, setChairman] = createSignal("");
  const [councilMode, setCouncilMode] = createSignal<CouncilMode>("discussion");
  const [activeField, setActiveField] = createSignal<Field>("topic");
  const [memberCursor, setMemberCursor] = createSignal(0);

  onMount(async () => {
    const config = await loadConfig().catch(() => null);
    const accs = props.accounts;
    const members = config?.council?.members ?? accs.slice(0, 3).map((a) => a.name);
    const chair = config?.council?.chairman ?? (accs[0]?.name ?? "");
    setSelectedMembers(members);
    setChairman(chair);
  });

  function toggleMember(name: string) {
    setSelectedMembers((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  function launch() {
    const t = topic().trim();
    if (!t) return;
    if (selectedMembers().length < 2) return;
    props.council.startCouncilInChat(t);
    props.onClose();
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
        if (memberCursor() >= props.accounts.length - 1) { setActiveField("chairman"); }
        else { setMemberCursor((p) => p + 1); }
        evt.stopPropagation(); return;
      }
      if (evt.name === "tab") {
        setActiveField("chairman");
        evt.stopPropagation(); return;
      }
      if (evt.name === "space" || evt.name === "return") {
        const acc = props.accounts[memberCursor()];
        if (acc) toggleMember(acc.name);
        evt.stopPropagation(); return;
      }
      evt.stopPropagation(); return;
    }

    if (field === "chairman") {
      if (evt.name === "up") { setActiveField("members"); evt.stopPropagation(); return; }
      if (evt.name === "down" || evt.name === "tab") { setActiveField("mode"); evt.stopPropagation(); return; }
      if (evt.name === "space" || evt.name === "return" || evt.name === "left" || evt.name === "right") {
        const members = selectedMembers();
        if (members.length > 0) {
          const curIdx = members.indexOf(chairman());
          const next = members[(curIdx + 1) % members.length];
          setChairman(next);
        }
        evt.stopPropagation(); return;
      }
      evt.stopPropagation(); return;
    }

    if (field === "mode") {
      if (evt.name === "up") { setActiveField("chairman"); evt.stopPropagation(); return; }
      if (evt.name === "space" || evt.name === "return" || evt.name === "left" || evt.name === "right") {
        setCouncilMode((m) => m === "discussion" ? "analysis" : "discussion");
        evt.stopPropagation(); return;
      }
      if (evt.name === "tab") { setActiveField("topic"); evt.stopPropagation(); return; }
      evt.stopPropagation(); return;
    }

    if (evt.ctrl && evt.name === "return") { launch(); evt.stopPropagation(); return; }
  });

  return (
    <box flexDirection="column" paddingX={2} paddingY={1} border={true} borderColor={colors.accent}>
      <text fg={colors.accent} attributes={TextAttributes.BOLD}>Council Discussion</text>
      <text fg={colors.textMuted}>Configure and launch a multi-agent council session</text>

      {}
      <box flexDirection="column" marginTop={1}>
        <text fg={activeField() === "topic" ? colors.primary : colors.textMuted} attributes={TextAttributes.BOLD}>
          Topic
        </text>
        <box flexDirection="row" border={activeField() === "topic" ? ["left"] : undefined} borderColor={colors.primary} paddingLeft={1}>
          <text fg={colors.text}>{topic() || ""}</text>
          <Show when={activeField() === "topic"}>
            <text fg={colors.primary}>{"\u2588"}</text>
          </Show>
          <Show when={!topic() && activeField() === "topic"}>
            <text fg={colors.textMuted}> Enter discussion topic...</text>
          </Show>
        </box>
      </box>

      {}
      <box flexDirection="column" marginTop={1}>
        <text fg={activeField() === "members" ? colors.primary : colors.textMuted} attributes={TextAttributes.BOLD}>
          Members ({selectedMembers().length})
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
        <text fg={activeField() === "chairman" ? colors.primary : colors.textMuted} attributes={TextAttributes.BOLD}>
          {"Chairman: "}
        </text>
        <text fg={colors.text}>{chairman() || "(none)"}</text>
        <Show when={activeField() === "chairman"}>
          <text fg={colors.textMuted}>{" \u2190/\u2192 to cycle"}</text>
        </Show>
      </box>

      {}
      <box flexDirection="row" marginTop={1}>
        <text fg={activeField() === "mode" ? colors.primary : colors.textMuted} attributes={TextAttributes.BOLD}>
          {"Mode: "}
        </text>
        <text fg={councilMode() === "discussion" ? colors.accent : colors.textMuted}>Discussion</text>
        <text fg={colors.textMuted}>{" / "}</text>
        <text fg={councilMode() === "analysis" ? colors.accent : colors.textMuted}>Analysis</text>
      </box>

      {}
      <box flexDirection="row" marginTop={1}>
        <Show when={topic().trim() && selectedMembers().length >= 2}>
          <text fg={colors.success}>Ctrl+Enter to launch</text>
        </Show>
        <Show when={!topic().trim()}>
          <text fg={colors.warning}>Enter a topic to continue</text>
        </Show>
        <Show when={topic().trim() && selectedMembers().length < 2}>
          <text fg={colors.warning}>Select at least 2 members</text>
        </Show>
        <text fg={colors.textMuted}>{"  Tab next field  Esc cancel"}</text>
      </box>
    </box>
  );
}
