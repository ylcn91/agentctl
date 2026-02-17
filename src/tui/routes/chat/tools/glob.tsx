
import { createMemo } from "solid-js";
import { InlineTool, parseInput, shortenPath, type ToolRendererProps } from "./shared.js";

export function GlobTool(props: ToolRendererProps) {
  const input = createMemo(() => parseInput(props.part.input));
  const pattern = createMemo(() => (input().pattern as string) ?? "");
  const searchPath = createMemo(() => (input().path as string) ?? "");
  const files = createMemo(() => {
    if (!props.part.output) return [];
    return props.part.output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  });

  const summary = createMemo(() => {
    const parts: string[] = [`Glob "${pattern()}"`];
    if (searchPath()) parts.push(`in ${shortenPath(searchPath())}`);
    if (files().length > 0) parts.push(`(${files().length} ${files().length === 1 ? "match" : "matches"})`);
    return parts.join(" ");
  });

  return (
    <InlineTool icon={"\u2731"} pending="Finding files..." complete={pattern()} summary={summary()} part={props.part} />
  );
}
