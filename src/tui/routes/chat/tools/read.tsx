
import { createMemo } from "solid-js";
import { InlineTool, parseInput, shortenPath, type ToolRendererProps } from "./shared.js";

export function ReadTool(props: ToolRendererProps) {
  const input = createMemo(() => parseInput(props.part.input));
  const filePath = createMemo(() =>
    (input().file_path as string) ?? (input().filePath as string) ?? "",
  );
  const output = createMemo(() => props.part.output ?? "");
  const lineCount = createMemo(() =>
    output() ? output().split("\n").length : 0,
  );

  const summary = createMemo(() => {
    const parts: string[] = [`Read ${shortenPath(filePath())}`];
    if (input().offset) parts.push(`offset:${input().offset}`);
    if (input().limit) parts.push(`limit:${input().limit}`);
    if (lineCount() > 0) parts.push(`(${lineCount()} lines)`);
    return parts.join(" ");
  });

  return (
    <InlineTool icon={"\u2192"} pending="Reading file..." complete={filePath()} summary={summary()} part={props.part} />
  );
}
