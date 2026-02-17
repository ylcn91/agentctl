
import { Show, Switch, Match, createMemo } from "solid-js";
import { useTheme } from "../../../context/theme.js";
import { BlockTool, InlineTool, parseInput, shortenPath, type ToolRendererProps } from "./shared.js";

const PREVIEW_LINES = 15;

export function WriteTool(props: ToolRendererProps) {
  const { colors, syntax } = useTheme();
  const input = createMemo(() => parseInput(props.part.input));
  const filePath = createMemo(() => (input().file_path as string) ?? (input().filePath as string) ?? "");
  const content = createMemo(() => (input().content as string) ?? "");
  const lineCount = createMemo(() => content() ? content().split("\n").length : 0);
  const overflow = createMemo(() => lineCount() > PREVIEW_LINES);
  const preview = createMemo(() => {
    if (!overflow()) return content();
    return content().split("\n").slice(0, PREVIEW_LINES).join("\n") + "\n\u2026";
  });

  const ext = createMemo(() => {
    const parts = filePath().split(".");
    return parts.length > 1 ? parts.pop()! : "";
  });

  return (
    <Switch>
      <Match when={props.part.status === "completed" || content()}>
        <BlockTool title={`# Wrote ${shortenPath(filePath())}`} part={props.part}>
          <box gap={1} flexDirection="column">
            <Show when={lineCount() > 0}>
              <text fg={colors.textMuted}>{lineCount()} lines</text>
            </Show>
            <Show when={content()}>
              <code
                content={preview()}
                filetype={ext()}
                syntaxStyle={syntax()}
                fg={colors.text}
              />
            </Show>
            <Show when={overflow()}>
              <text fg={colors.textMuted}>
                {`${lineCount()} lines total`}
              </text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon={"\u2190"} pending="Preparing write..." complete={filePath()} summary={`Write ${shortenPath(filePath())}`} part={props.part} />
      </Match>
    </Switch>
  );
}
