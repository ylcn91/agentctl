
import { Show, Switch, Match, createMemo } from "solid-js";
import { useTheme } from "../../../context/theme.js";
import { BlockTool, InlineTool, parseInput, shortenPath, type ToolRendererProps } from "./shared.js";

export function EditTool(props: ToolRendererProps) {
  const { colors, syntax } = useTheme();
  const input = createMemo(() => parseInput(props.part.input));
  const filePath = createMemo(() =>
    (input().file_path as string) ?? (input().filePath as string) ?? "",
  );
  const oldString = createMemo(() => (input().old_string as string) ?? (input().oldString as string) ?? "");
  const newString = createMemo(() => (input().new_string as string) ?? (input().newString as string) ?? "");

  const diffContent = createMemo(() => {
    const old = oldString();
    const nu = newString();
    if (!old && !nu) return "";
    const oldLines = old.split("\n").map((l) => `- ${l}`);
    const newLines = nu.split("\n").map((l) => `+ ${l}`);
    return [
      `--- a/${filePath()}`,
      `+++ b/${filePath()}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines,
      ...newLines,
    ].join("\n");
  });

  const ext = createMemo(() => {
    const parts = filePath().split(".");
    return parts.length > 1 ? parts.pop()! : "";
  });

  return (
    <Switch>
      <Match when={diffContent()}>
        <BlockTool title={`\u2190 Edit ${shortenPath(filePath())}`} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view="unified"
              filetype={ext()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              fg={colors.text}
              addedBg={colors.diffAddedBg}
              removedBg={colors.diffRemovedBg}
              contextBg={colors.diffContextBg}
              addedSignColor={colors.diffHighlightAdded}
              removedSignColor={colors.diffHighlightRemoved}
              lineNumberFg={colors.diffLineNumber}
              lineNumberBg={colors.diffContextBg}
              addedLineNumberBg={colors.diffAddedLineNumberBg}
              removedLineNumberBg={colors.diffRemovedLineNumberBg}
            />
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon={"\u2190"} pending="Preparing edit..." complete={filePath()} summary={`Edit ${shortenPath(filePath())}`} part={props.part} />
      </Match>
    </Switch>
  );
}
