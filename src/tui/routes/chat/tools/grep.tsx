
import { createMemo } from "solid-js";
import { InlineTool, parseInput, shortenPath, type ToolRendererProps } from "./shared.js";

export function GrepTool(props: ToolRendererProps) {
  const input = createMemo(() => parseInput(props.part.input));
  const pattern = createMemo(() => (input().pattern as string) ?? "");
  const searchPath = createMemo(() => (input().path as string) ?? "");
  const matchLines = createMemo(() => {
    if (!props.part.output) return [];
    return props.part.output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  });
  const fileCount = createMemo(() => {
    const seen = new Set<string>();
    for (const line of matchLines()) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) seen.add(line.slice(0, colonIdx));
    }
    return seen.size;
  });

  const summary = createMemo(() => {
    const parts: string[] = [`Grep "${pattern()}"`];
    if (searchPath()) parts.push(`in ${shortenPath(searchPath())}`);
    if (matchLines().length > 0) {
      let stat = `(${matchLines().length} ${matchLines().length === 1 ? "match" : "matches"}`;
      if (fileCount() > 0) stat += ` in ${fileCount()} files`;
      stat += ")";
      parts.push(stat);
    }
    return parts.join(" ");
  });

  return (
    <InlineTool icon={"\u2731"} pending="Searching content..." complete={pattern()} summary={summary()} part={props.part} />
  );
}
