
import { createSignal, createMemo, onCleanup, Index, For, Show } from "solid-js";
import { TextAttributes, RGBA } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "../../context/theme.js";
import type { Mode, SlashCommand } from "./helpers.js";
import { getModelsForProvider } from "./helpers.js";

export function BlinkingCursor(props: {
  color: string | RGBA;
  active: boolean;
  streaming?: boolean;
}) {
  const [visible, setVisible] = createSignal(true);

  const timer = setInterval(() => {
    if (!props.active || props.streaming) {
      setVisible(true);
      return;
    }
    setVisible((v) => !v);
  }, 530);
  onCleanup(() => clearInterval(timer));

  return (
    <Show when={props.active} fallback={<text> </text>}>
      <Show
        when={!props.streaming}
        fallback={<text fg={props.color}>{"\u2588"}</text>}
      >
        <text fg={props.color}>{visible() ? "\u2588" : " "}</text>
      </Show>
    </Show>
  );
}

export function ModelPicker(props: {
  currentModel: string | undefined;
  provider: string;
  onSelect: (modelId: string | undefined) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const providerModels = getModelsForProvider(props.provider);
  const options = [
    ...providerModels.map((m) => ({ id: m.id, label: m.label, short: m.short })),
    { id: "__default__", label: "Default", short: "default" },
  ];
  const activeIdx = () =>
    props.currentModel
      ? options.findIndex((o) => o.id === props.currentModel)
      : options.length - 1;
  const [selected, setSelected] = createSignal(Math.max(0, activeIdx()));

  useKeyboard((evt: any) => {
    if (evt.name === "escape") { props.onClose(); evt.stopPropagation(); return; }
    if (evt.name === "return") {
      const chosen = options[selected()];
      props.onSelect(chosen.id === "__default__" ? undefined : chosen.id);
      evt.stopPropagation();
      return;
    }
    if (evt.name === "up" || evt.name === "k") {
      setSelected((p) => Math.max(0, p - 1));
      evt.stopPropagation();
    } else if (evt.name === "down" || evt.name === "j") {
      setSelected((p) => Math.min(options.length - 1, p + 1));
      evt.stopPropagation();
    }
  });

  return (
    <box flexDirection="column" border={true} borderColor={colors.primary} paddingX={2} paddingY={1}>
      <text attributes={TextAttributes.BOLD} fg={colors.primary}>Choose Model</text>
      <box flexDirection="column" marginTop={1}>
        <For each={options}>
          {(opt, idx) => {
            const isSel = () => idx() === selected();
            const isActive = () => opt.id === (props.currentModel ?? "__default__");
            return (
              <box flexDirection="row">
                <text fg={isSel() ? colors.primary : colors.text}>{isSel() ? "> " : "  "}</text>
                <text fg={isSel() ? colors.primary : colors.text} attributes={isSel() ? TextAttributes.BOLD : undefined}>{opt.label.padEnd(20)}</text>
                <text fg={colors.textMuted}>{opt.short}</text>
                <Show when={isActive()}>
                  <text fg={colors.success}>{" \u25cf"}</text>
                </Show>
              </box>
            );
          }}
        </For>
      </box>
      <box marginTop={1}>
        <text fg={colors.textMuted}>j/k navigate  Enter select  Esc close</text>
      </box>
    </box>
  );
}

export function SlashCommandDropdown(props: {
  commands: SlashCommand[];
  selected: number;
}) {
  const { colors } = useTheme();
  const listHeight = createMemo(() => Math.min(8, Math.max(1, props.commands.length)));

  return (
    <box flexDirection="column" paddingX={2} flexShrink={1}>
      <box border={true} borderColor={colors.primary} height={listHeight() + 2} overflow="hidden">
        <scrollbox
          height={listHeight()}
          backgroundColor={colors.backgroundElement}
          scrollbarOptions={{ visible: false }}
        >
          <Index
            each={props.commands}
            fallback={
              <box paddingLeft={1} paddingRight={1}>
                <text fg={colors.textMuted}>No matching commands</text>
              </box>
            }
          >
            {(cmd, index) => (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={index === props.selected ? colors.primary : undefined}
              >
                <text
                  fg={index === props.selected ? colors.background : colors.text}
                  flexShrink={0}
                  attributes={index === props.selected ? TextAttributes.BOLD : undefined}
                >
                  {index === props.selected ? "> " : "  "}
                </text>
                <text
                  fg={index === props.selected ? colors.background : colors.primary}
                  flexShrink={0}
                  attributes={index === props.selected ? TextAttributes.BOLD : undefined}
                >
                  {cmd().label}
                </text>
                <text fg={index === props.selected ? colors.background : colors.textMuted} wrapMode="none">
                  {"  " + cmd().description}
                </text>
              </box>
            )}
          </Index>
        </scrollbox>
      </box>
    </box>
  );
}

export function FileDropdown(props: {
  files: string[];
  selected: number;
  query: string;
}) {
  const { colors } = useTheme();
  const MAX_VISIBLE = 8;
  const visibleFiles = () => props.files.slice(0, MAX_VISIBLE);

  const listHeight = createMemo(() => Math.min(MAX_VISIBLE, Math.max(1, visibleFiles().length)) + 1);

  return (
    <box flexDirection="column" paddingX={2}>
      <box border={true} borderColor={colors.accent}>
        <scrollbox
          height={listHeight()}
          backgroundColor={colors.backgroundElement}
          scrollbarOptions={{ visible: false }}
          paddingLeft={1}
          paddingRight={1}
        >
          <Index
            each={visibleFiles()}
            fallback={
              <box paddingLeft={1}>
                <text fg={colors.textMuted}>No matching files</text>
              </box>
            }
          >
            {(file, index) => (
              <box
                flexDirection="row"
                backgroundColor={index === props.selected ? colors.accent : undefined}
              >
                <text fg={index === props.selected ? colors.background : colors.text} flexShrink={0}>
                  {index === props.selected ? "> " : "  "}
                </text>
                <text
                  fg={index === props.selected ? colors.background : colors.text}
                  attributes={index === props.selected ? TextAttributes.BOLD : undefined}
                  wrapMode="none"
                >
                  {file()}
                </text>
              </box>
            )}
          </Index>
          <Show when={props.files.length > MAX_VISIBLE}>
            <text fg={colors.textMuted}>{`  ...and ${props.files.length - MAX_VISIBLE} more`}</text>
          </Show>
        </scrollbox>
      </box>
    </box>
  );
}

interface InputAreaProps {
  mode: Mode;
  inputBuffer: string;
  cursorPos: number;
  streaming: boolean;
  shellMode?: boolean;
  accountColor: string | RGBA;
  accountName: string;
  providerLabel?: string;
  modelLabel?: string;
  totalCost?: number;
}

export function InputArea(props: InputAreaProps) {
  const { colors } = useTheme();
  const isShell = () => props.shellMode ?? false;
  const accentColor = () => {
    if (props.mode !== "input") return colors.textMuted;
    if (isShell()) return colors.warning;
    return props.accountColor;
  };

  const lines = () => props.inputBuffer.split("\n");
  const cursorLine = () => {
    let pos = 0;
    const ls = lines();
    for (let i = 0; i < ls.length; i++) {
      if (pos + ls[i].length >= props.cursorPos || i === ls.length - 1) {
        return i;
      }
      pos += ls[i].length + 1;
    }
    return 0;
  };
  const cursorCol = () => {
    let pos = 0;
    const ls = lines();
    for (let i = 0; i < cursorLine(); i++) {
      pos += ls[i].length + 1;
    }
    return props.cursorPos - pos;
  };

  return (
    <box flexDirection="column" paddingX={2} flexShrink={0}>
      <box
        border={["left"]}
        borderColor={accentColor()}
        customBorderChars={{
          vertical: "\u2503",
          bottomLeft: "\u2579",
          topLeft: "",
          topRight: "",
          bottomRight: "",
          horizontal: " ",
          topT: "",
          bottomT: "",
          leftT: "",
          rightT: "",
          cross: "",
        }}
      >
        <box
          flexDirection="column"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          backgroundColor={colors.backgroundElement}
          flexGrow={1}
          minHeight={3}
        >
          <box flexDirection="column" flexGrow={1}>
            <Show when={props.mode === "input" && props.inputBuffer.length === 0 && !props.streaming}>
              <box flexDirection="row">
                <BlinkingCursor color={accentColor()} active={props.mode === "input"} streaming={props.streaming} />
                <text fg={isShell() ? colors.warning : colors.textMuted}>
                  {isShell() ? " Enter shell command..." : " Ask anything..."}
                </text>
              </box>
            </Show>
            <Show when={props.mode === "input" && props.inputBuffer.length === 0 && props.streaming}>
              <box flexDirection="row">
                <BlinkingCursor color={accentColor()} active={true} streaming={true} />
                <text fg={colors.textMuted}>{" Responding\u2026 (Ctrl+C to cancel)"}</text>
              </box>
            </Show>
            <Show when={props.mode === "input" && props.inputBuffer.length > 0}>
              <For each={lines()}>
                {(line, lineIdx) => {
                  const isCursorLine = () => lineIdx() === cursorLine();
                  const before = () => isCursorLine() ? line.slice(0, cursorCol()) : line;
                  const after = () => isCursorLine() ? line.slice(cursorCol()) : "";
                  return (
                    <box flexDirection="row">
                      <Show when={lineIdx() === 0 && isShell()}>
                        <text fg={colors.warning} attributes={TextAttributes.BOLD}>{"$ "}</text>
                      </Show>
                      <text>{before()}</text>
                      <Show when={isCursorLine()}>
                        <BlinkingCursor color={accentColor()} active={props.mode === "input"} streaming={props.streaming} />
                      </Show>
                      <Show when={after().length > 0}>
                        <text>{after()}</text>
                      </Show>
                    </box>
                  );
                }}
              </For>
            </Show>
            <Show when={props.mode === "browse"}>
              <box flexDirection="row">
                <text fg={colors.textMuted} attributes={TextAttributes.ITALIC}>Press Enter or i to type</text>
              </box>
            </Show>
          </box>
          <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1}>
            <text fg={accentColor()}>{props.accountName}</text>
            <Show when={props.providerLabel}>
              <text fg={colors.textMuted}>{props.providerLabel}</text>
            </Show>
            <Show when={props.modelLabel && props.modelLabel !== "default"}>
              <text fg={colors.textMuted}>{props.modelLabel}</text>
            </Show>
            <Show when={props.totalCost != null && props.totalCost! > 0}>
              <text fg={colors.textMuted}>{`$${props.totalCost!.toFixed(4)}`}</text>
            </Show>
          </box>
        </box>
      </box>
      <box
        height={1}
        border={["left"]}
        borderColor={accentColor()}
        customBorderChars={{
          vertical: "\u2579",
          bottomLeft: "",
          topLeft: "",
          topRight: "",
          bottomRight: "",
          horizontal: " ",
          topT: "",
          bottomT: "",
          leftT: "",
          rightT: "",
          cross: "",
        }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={colors.backgroundElement}
          customBorderChars={{
            horizontal: "\u2580",
            vertical: " ",
            bottomLeft: "",
            topLeft: "",
            topRight: "",
            bottomRight: "",
            topT: "",
            bottomT: "",
            leftT: "",
            rightT: "",
            cross: "",
          }}
        />
      </box>
    </box>
  );
}
