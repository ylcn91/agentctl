
import { Show, Switch, Match, createMemo } from "solid-js";
import { useTheme } from "../../../context/theme.js";
import { BlockTool, InlineTool, parseInput, truncate, type ToolRendererProps } from "./shared.js";

const OUTPUT_COLLAPSE_LINES = 10;

export function BashTool(props: ToolRendererProps) {
  const { colors } = useTheme();
  const input = createMemo(() => parseInput(props.part.input));
  const command = createMemo(() => (input().command as string) ?? "");
  const output = createMemo(() => {
    if (!props.part.output) return "";
    return props.part.output.trim();
  });
  const lines = createMemo(() => output().split("\n"));
  const overflow = createMemo(() => lines().length > OUTPUT_COLLAPSE_LINES);
  const limited = createMemo(() => {
    if (!overflow()) return output();
    return [...lines().slice(0, OUTPUT_COLLAPSE_LINES), "\u2026"].join("\n");
  });

  const description = createMemo(() => (input().description as string) ?? "Shell");

  return (
    <Switch>
      <Match when={props.part.output !== undefined}>
        <BlockTool title={`# ${description()}`} part={props.part}>
          <box gap={1} flexDirection="column">
            <text fg={colors.text}>$ {command()}</text>
            <Show when={output()}>
              <text fg={colors.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={colors.textMuted}>
                {`${lines().length - OUTPUT_COLLAPSE_LINES} more lines`}
              </text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={command()} summary={truncate(command(), 80)} part={props.part} />
      </Match>
    </Switch>
  );
}
