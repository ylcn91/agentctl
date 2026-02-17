
import { createMemo } from "solid-js";
import { InlineTool, parseInput, truncate, type ToolRendererProps } from "./shared.js";

export function FetchTool(props: ToolRendererProps) {
  const input = createMemo(() => parseInput(props.part.input));
  const url = createMemo(() => (input().url as string) ?? "");

  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={url()} summary={`WebFetch ${truncate(url(), 60)}`} part={props.part} />
  );
}
