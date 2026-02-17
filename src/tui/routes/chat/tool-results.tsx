
import { For, Show, createMemo, createSignal, createEffect, onCleanup } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../context/theme.js";
import { parseToolInput } from "./helpers.js";

const TEXT_RENDER_THROTTLE_MS = 100;

function createThrottledValue(getValue: () => string): () => string {
  const [value, setValue] = createSignal(getValue());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let last = 0;

  createEffect(() => {
    const next = getValue();
    const now = Date.now();
    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last);
    if (remaining <= 0) {
      if (timeout) { clearTimeout(timeout); timeout = undefined; }
      last = now;
      setValue(next);
      return;
    }
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      last = Date.now();
      setValue(next);
      timeout = undefined;
    }, remaining);
  });

  onCleanup(() => { if (timeout) clearTimeout(timeout); });

  return value;
}

export interface StreamingChunk {
  chunkType: string;
  content: string;
  toolName?: string;
  toolInput?: string;
}

const MAX_VISIBLE_TOOLS = 4;
const STREAM_VISIBLE_LINES = 30;

function StreamingMarkdown(props: { text: () => string; syntaxStyle: any }) {
  const throttled = createThrottledValue(props.text);
  return (
    <Show when={throttled()} keyed>
      {(text: string) => <markdown content={text} syntaxStyle={props.syntaxStyle} />}
    </Show>
  );
}

function parseFilePath(input: string): string {
  try {
    const obj = JSON.parse(input);
    if (obj.file_path) {
      const parts = obj.file_path.split("/");
      return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : obj.file_path;
    }
    return "";
  } catch {
    return "";
  }
}

export function CollapsedStreamChunks(props: { chunks: StreamingChunk[] }) {
  const { colors, syntax } = useTheme();

  const parsed = createMemo(() => {
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolCalls: { name: string; summary: string; toolInput?: string }[] = [];
    let lastToolResult: string | null = null;

    for (const chunk of props.chunks) {
      if (chunk.chunkType === "text") {
        textParts.push(chunk.content);
      } else if (chunk.chunkType === "thinking") {
        thinkingParts.push(chunk.content);
      } else if (chunk.chunkType === "tool_use") {
        const summary = chunk.toolInput ? parseToolInput(chunk.toolInput) : "";
        toolCalls.push({ name: chunk.toolName ?? chunk.content, summary, toolInput: chunk.toolInput });
        lastToolResult = null;
      } else if (chunk.chunkType === "tool_result") {
        lastToolResult = chunk.content;
      }
    }

    const thinkingText = thinkingParts.join("");
    const nonEmptyThinking = thinkingText.split("\n").filter(Boolean);
    const thinkingPreview = nonEmptyThinking.slice(-6).map((l) => l.trim()).join("\n");

    const recentTools = toolCalls.slice(-MAX_VISIBLE_TOOLS);
    const hiddenCount = toolCalls.length - MAX_VISIBLE_TOOLS;

    const streamingText = textParts.join("");
    const hasText = streamingText.length > 0;
    const streamLines = hasText ? streamingText.split("\n") : [];
    const streamOverflow = streamLines.length > STREAM_VISIBLE_LINES;
    const visibleStreamText = streamOverflow
      ? streamLines.slice(-STREAM_VISIBLE_LINES).join("\n")
      : streamingText;

    return {
      thinkingPreview,
      recentTools,
      hiddenCount,
      hasText,
      streamingText,
      visibleStreamText,
      streamOverflow,
      streamLines,
      lastToolResult,
    };
  });

  return (
    <box flexDirection="column">
      <Show when={parsed().thinkingPreview}>
        <box border={["left"]} borderColor={colors.primary} paddingLeft={1} marginLeft={1}>
          <box flexDirection="column">
            <text fg={colors.primary} attributes={TextAttributes.BOLD | TextAttributes.ITALIC}>Thinking</text>
            <text fg={colors.secondary}>{parsed().thinkingPreview}</text>
          </box>
        </box>
      </Show>

      <Show when={parsed().hiddenCount > 0}>
        <text fg={colors.success}>
          {`  \u2713 ${parsed().hiddenCount} tool${parsed().hiddenCount > 1 ? "s" : ""} completed`}
        </text>
      </Show>

      <For each={parsed().recentTools}>
        {(tool, idx) => {
          const isDone = () =>
            idx() < parsed().recentTools.length - 1 || parsed().lastToolResult !== null;
          const isLast = () => idx() === parsed().recentTools.length - 1;
          const resultPreview = () => {
            if (isDone() && isLast() && parsed().lastToolResult) {
              return parsed().lastToolResult!.split("\n").find((l) => l.trim())?.trim().slice(0, 80);
            }
            return undefined;
          };
          return (
            <box flexDirection="column">
              <box flexDirection="row">
                <text fg={isDone() ? colors.success : colors.warning}>
                  {isDone() ? " \u2713 " : " \u25A0 "}
                </text>
                <text fg={isDone() ? colors.success : colors.warning} attributes={TextAttributes.BOLD}>{tool.name}</text>
                <Show when={tool.summary}>
                  <text fg={colors.textMuted}> {tool.summary.slice(0, 60)}</text>
                </Show>
                <Show when={(tool.name === "Edit" || tool.name === "Write") && tool.toolInput}>
                  <text fg={colors.textMuted}>{` ${parseFilePath(tool.toolInput!)}`}</text>
                </Show>
              </box>
              <Show when={resultPreview()}>
                <text fg={colors.textMuted}>{`    \u2192 ${resultPreview()}`}</text>
              </Show>
            </box>
          );
        }}
      </For>

      <Show when={parsed().hasText}>
        <Show when={parsed().streamOverflow}>
          <text fg={colors.textMuted}>{`  ... ${parsed().streamLines.length - STREAM_VISIBLE_LINES} lines above`}</text>
        </Show>
        <StreamingMarkdown text={() => parsed().visibleStreamText} syntaxStyle={syntax()} />
      </Show>
    </box>
  );
}
