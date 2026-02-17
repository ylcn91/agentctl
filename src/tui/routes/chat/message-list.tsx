
import { For, Show, createSignal, createMemo, createEffect, on, onCleanup, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { TextAttributes, RGBA, type ScrollBoxRenderable } from "@opentui/core";
import { useTheme } from "../../context/theme.js";
import type { ChatMessage, TextPart as TextPartType, ThinkingPart as ThinkingPartType, ToolPart as ToolPartType, ErrorPart as ErrorPartType } from "../../../services/chat-session.js";
import { modelShortLabel, truncateContent, MAX_STREAMING_CHUNKS } from "./helpers.js";
import { CollapsedStreamChunks, type StreamingChunk } from "./tool-results.js";
import { ToolComponents, DefaultTool } from "./tools/index.js";
import { CouncilMessageBlock, RetroMessageBlock, type CouncilState, type RetroState } from "./council-inline.js";

const COUNCIL_EVENT_RE = /^\[council[\]\-]|^\[retro[\]\-]/;
function isCouncilEvent(msg: ChatMessage): boolean {
  return msg.role === "assistant" && COUNCIL_EVENT_RE.test(msg.content.trimStart());
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

function TextPartView(props: { part: TextPartType }) {
  const { syntax } = useTheme();
  const content = createMemo(() => truncateContent(props.part.text));

  return (
    <Show when={content()}>
      <box paddingLeft={1} marginTop={1}>
        <markdown
          content={content()}
          syntaxStyle={syntax()}
        />
      </box>
    </Show>
  );
}

function ReasoningPartView(props: { part: ThinkingPartType }) {
  const { colors } = useTheme();

  const content = createMemo(() => {
    const text = props.part.text;
    if (!text) return "";
    return text.replace(/\[REDACTED\]/g, "").trim();
  });

  return (
    <Show when={content()}>
      <box paddingLeft={1} marginTop={1} flexDirection="column">
        <text fg={colors.textMuted} attributes={TextAttributes.ITALIC}>{`Thinking: ${content()}`}</text>
      </box>
    </Show>
  );
}

function ToolPartView(props: { part: ToolPartType }) {
  const Renderer = () => ToolComponents[props.part.name] ?? DefaultTool;
  return (
    <box marginTop={1}>
      <Dynamic component={Renderer()} part={props.part} />
    </box>
  );
}

function ErrorPartView(props: { part: ErrorPartType }) {
  const { colors } = useTheme();
  return (
    <box paddingLeft={1} marginTop={1}>
      <text fg={colors.error}>{props.part.text}</text>
    </box>
  );
}

const PART_MAPPING: Record<string, Component<{ part: any }>> = {
  text: TextPartView,
  thinking: ReasoningPartView,
  tool: ToolPartView,
  error: ErrorPartView,
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function StreamingSpinner(props: {
  label: string;
  color: string | RGBA;
}) {
  const { colors } = useTheme();
  const [frame, setFrame] = createSignal(0);
  const [elapsed, setElapsed] = createSignal(0);
  const start = Date.now();

  const timer = setInterval(() => {
    setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    setElapsed(Math.floor((Date.now() - start) / 1000));
  }, 80);
  onCleanup(() => clearInterval(timer));

  const elapsedLabel = () => {
    const s = elapsed();
    if (s < 1) return "";
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  };

  return (
    <box flexDirection="row">
      <text fg={props.color}>{SPINNER_FRAMES[frame()]}</text>
      <text fg={props.color} attributes={TextAttributes.BOLD}>{` ${props.label}`}</text>
      <text fg={colors.textMuted}> is thinking</text>
      <Show when={elapsedLabel()}>
        <text fg={colors.textMuted}>{` \u00b7 ${elapsedLabel()}`}</text>
      </Show>
    </box>
  );
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingChunks: StreamingChunk[];
  streaming: boolean;
  error: string | null;
  autoScroll: boolean;
  scrollOffset: number;
  accountName: string;
  accountColor: string | RGBA;
  modelLabel?: string;
  councilStates?: Map<string, CouncilState>;
  councilVersion?: number;
  retroStates?: Map<string, RetroState>;
  retroVersion?: number;
}

export function MessageList(props: MessageListProps) {
  const { colors } = useTheme();

  let scroll: ScrollBoxRenderable;

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return;
      scroll.scrollTo(scroll.scrollHeight);
    }, 50);
  }

  createEffect(on(() => props.messages.length, toBottom));
  createEffect(on(() => props.streaming, (s) => { if (!s) toBottom(); }));

  const filteredMessages = createMemo(() =>
    props.messages.filter((m) => {
      if (props.councilStates?.has(m.id) || props.retroStates?.has(m.id)) return true;
      return !isCouncilEvent(m);
    }),
  );

  const visibleStreamChunks = createMemo(() =>
    props.streamingChunks.slice(-MAX_STREAMING_CHUNKS),
  );

  const streamingLabel = createMemo(() => {
    const model = props.modelLabel;
    if (model && model !== "default") {
      const capitalized = model.charAt(0).toUpperCase() + model.slice(1);
      return capitalized;
    }
    return props.accountName;
  });

  return (
    <scrollbox ref={(r: ScrollBoxRenderable) => (scroll = r)} flexDirection="column" stickyScroll stickyStart="bottom" flexGrow={1} scrollbarOptions={{ visible: false }}>
      <For each={filteredMessages()}>
        {(msg, idx) => (
          <MessageBubble
            message={msg}
            accountName={props.accountName}
            accountColor={props.accountColor}
            isFirst={idx() === 0}
            councilState={props.councilStates?.get(msg.id)}
            councilVersion={props.councilVersion}
            retroState={props.retroStates?.get(msg.id)}
            retroVersion={props.retroVersion}
          />
        )}
      </For>

      <box flexDirection="column" marginTop={props.streaming ? 1 : 0}>
        <Show when={props.streaming}>
          <box flexDirection="column" minHeight={2}>
            <Show
              when={visibleStreamChunks().length > 0}
              fallback={
                <StreamingSpinner label={streamingLabel()} color={props.accountColor} />
              }
            >
              <box flexDirection="row">
                <text fg={props.accountColor} attributes={TextAttributes.BOLD}>{streamingLabel()}</text>
              </box>
              <CollapsedStreamChunks chunks={visibleStreamChunks()} />
            </Show>
          </box>
        </Show>
      </box>

      <Show when={props.error}>
        <box marginTop={1}>
          <text fg={colors.error}>{`Error: ${props.error!.slice(0, 200)}`}</text>
        </box>
      </Show>

    </scrollbox>
  );
}

function MessageBubble(props: {
  message: ChatMessage;
  accountName: string;
  accountColor: string | RGBA;
  isFirst: boolean;
  councilState?: CouncilState;
  councilVersion?: number;
  retroState?: RetroState;
  retroVersion?: number;
}) {
  const { colors, syntax } = useTheme();

  const displayContent = () => truncateContent(props.message.content);
  const isUser = () => props.message.role === "user";
  const hasParts = () => props.message.parts && props.message.parts.length > 0;

  if (!props.message.content && (!props.message.parts || props.message.parts.length === 0)) {
    return null;
  }

  if (props.councilState) {
    return <CouncilMessageBlock state={props.councilState} version={props.councilVersion} />;
  }

  if (props.retroState) {
    return <RetroMessageBlock state={props.retroState} version={props.retroVersion} />;
  }

  if (isUser()) {
    return (
      <box
        border={["left"]}
        borderColor={props.accountColor}
        marginTop={props.isFirst ? 0 : 1}
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
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          backgroundColor={colors.backgroundElement}
          flexShrink={0}
          flexDirection="column"
        >
          <text fg={colors.text}>{displayContent()}</text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" marginTop={1}>
      <Show when={hasParts()}>
        <For each={props.message.parts!}>
          {(part) => {
            const component = PART_MAPPING[part.type];
            return (
              <Show when={component}>
                <Dynamic component={component!} part={part} />
              </Show>
            );
          }}
        </For>
      </Show>

      <Show when={!hasParts() && displayContent()}>
        <box paddingLeft={1} marginTop={1}>
          <markdown
            content={displayContent()}
            syntaxStyle={syntax()}
          />
        </box>
      </Show>

      <box flexDirection="row" paddingLeft={1} marginTop={1}>
        <text fg={props.accountColor}>{"\u25A3 "}</text>
        <text fg={props.accountColor} attributes={TextAttributes.BOLD}>{props.accountName}</text>
        <Show when={props.message.model}>
          <text fg={colors.textMuted}>{` \u00b7 ${modelShortLabel(props.message.model!)}`}</text>
        </Show>
        <Show when={props.message.durationMs != null}>
          <text fg={colors.textMuted}>{` \u00b7 ${(props.message.durationMs! / 1000).toFixed(1)}s`}</text>
        </Show>
        <Show when={props.message.cost != null && props.message.cost! > 0}>
          <text fg={colors.textMuted}>{` \u00b7 $${props.message.cost!.toFixed(4)}`}</text>
        </Show>
        <Show when={props.message.inputTokens != null || props.message.outputTokens != null}>
          <text fg={colors.textMuted}>
            {` \u00b7 \u2191${fmtTokens(props.message.inputTokens ?? 0)} \u2193${fmtTokens(props.message.outputTokens ?? 0)}`}
          </text>
        </Show>
      </box>
    </box>
  );
}
