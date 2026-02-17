
import { Show, createMemo } from "solid-js";
import { useTheme } from "../../../context/theme.js";
import { InlineTool, parseInput, truncate, type ToolRendererProps } from "./shared.js";

export function DefaultTool(props: ToolRendererProps) {
  const { colors } = useTheme();
  const input = createMemo(() => parseInput(props.part.input));

  const inputSummary = createMemo(() => {
    const obj = input();
    const vals = Object.values(obj).filter((v) => typeof v === "string") as string[];
    return vals[0] ? truncate(vals[0], 60) : "";
  });

  const outputPreview = createMemo(() => {
    if (!props.part.output) return "";
    return truncate(props.part.output.trim(), 80);
  });

  const summary = createMemo(() => {
    const s = inputSummary();
    return s ? `${props.part.name} ${s}` : props.part.name;
  });

  return (
    <box flexDirection="column">
      <InlineTool icon={"\u2699"} pending={`Running ${props.part.name}...`} complete={true} summary={summary()} part={props.part} />
      <Show when={outputPreview()}>
        <box paddingLeft={4}>
          <text fg={colors.textMuted}>{`\u2192 ${outputPreview()}`}</text>
        </box>
      </Show>
    </box>
  );
}
