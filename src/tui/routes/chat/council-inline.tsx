
import { For, Show, createMemo } from "solid-js";
import { TextAttributes, type RGBA } from "@opentui/core";
import { useTheme } from "../../context/theme.js";

export interface CouncilPhase {
  name: string;
  status: "pending" | "active" | "done";
  responses: Array<{ account: string; content: string }>;
}

export interface CouncilState {
  topic: string;
  members: string[];
  phases: CouncilPhase[];
  streaming: Map<string, { text: string; phase: string }>;
  synthesis?: string;
  error?: string;
  done: boolean;
}

export interface RetroState {
  topic: string;
  members: string[];
  wellItems: Array<{ account: string; content: string }>;
  issueItems: Array<{ account: string; content: string }>;
  actionItems: string[];
  done: boolean;
  error?: string;
}

const PHASE_ICONS: Record<string, string> = {
  pending: "\u25CB",
  active: "\u25A0",
  done: "\u2713",
};

function PhaseIndicator(props: { phases: CouncilPhase[] }) {
  const { colors } = useTheme();
  return (
    <box flexDirection="row" marginTop={1}>
      <For each={props.phases}>
        {(phase, idx) => {
          const color = () => {
            switch (phase.status) {
              case "done": return colors.success;
              case "active": return colors.warning;
              default: return colors.textMuted;
            }
          };
          return (
            <box flexDirection="row">
              <Show when={idx() > 0}>
                <text fg={colors.textMuted}>{" \u2192 "}</text>
              </Show>
              <text fg={color()}>{PHASE_ICONS[phase.status] ?? "\u25CB"}</text>
              <text fg={color()}>{` ${phase.name}`}</text>
            </box>
          );
        }}
      </For>
    </box>
  );
}

export function CouncilMessageBlock(props: { state: CouncilState; version?: number }) {
  const { colors } = useTheme();

  const memberColors = createMemo(() => {
    const palette = [colors.accent, colors.primary, colors.secondary, colors.success, colors.warning];
    const map: Record<string, string | RGBA> = {};
    props.state.members.forEach((m, i) => {
      map[m] = palette[i % palette.length];
    });
    return map;
  });

  const phases = createMemo(() => {
    void props.version;
    return props.state.phases.map((p) => ({ ...p, responses: [...p.responses] }));
  });

  const allResponses = createMemo(() => {
    void props.version;
    const out: Array<{ account: string; content: string; phase: string }> = [];
    for (const phase of props.state.phases) {
      for (const resp of phase.responses) {
        out.push({ ...resp, phase: phase.name });
      }
    }
    return out;
  });

  const activeStreams = createMemo(() => {
    void props.version;
    const streaming = props.state.streaming;
    if (!streaming || streaming.size === 0) return [];
    return [...streaming.entries()].map(([account, { text, phase }]) => ({ account, text, phase }));
  });

  const synthesis = createMemo(() => {
    void props.version;
    return props.state.synthesis;
  });

  const error = createMemo(() => {
    void props.version;
    return props.state.error;
  });

  const done = createMemo(() => {
    void props.version;
    return props.state.done;
  });

  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row">
        <text fg={colors.accent} attributes={TextAttributes.BOLD}>{"Council: "}</text>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{props.state.topic}</text>
      </box>
      <box flexDirection="row" marginTop={0}>
        <text fg={colors.textMuted}>{"Members: "}</text>
        <For each={props.state.members}>
          {(member, idx) => (
            <box flexDirection="row">
              <Show when={idx() > 0}>
                <text fg={colors.textMuted}>{", "}</text>
              </Show>
              <text fg={memberColors()[member]}>{member}</text>
            </box>
          )}
        </For>
      </box>

      <PhaseIndicator phases={phases()} />

      <For each={allResponses()}>
        {(resp) => (
          <box
            flexDirection="column"
            marginTop={1}
            border={["left"]}
            borderColor={memberColors()[resp.account] ?? colors.textMuted}
            paddingLeft={1}
          >
            <box flexDirection="row">
              <text fg={memberColors()[resp.account] ?? colors.text} attributes={TextAttributes.BOLD}>
                {resp.account}
              </text>
              <text fg={colors.textMuted}>{` [${resp.phase}]`}</text>
            </box>
            <text fg={colors.text}>{(resp.content || "(no response)").slice(0, 2000)}</text>
          </box>
        )}
      </For>

      <For each={activeStreams()}>
        {(stream) => (
          <box
            flexDirection="column"
            marginTop={1}
            border={["left"]}
            borderColor={memberColors()[stream.account] ?? colors.primary}
            paddingLeft={1}
          >
            <box flexDirection="row">
              <text fg={memberColors()[stream.account] ?? colors.text} attributes={TextAttributes.BOLD}>
                {stream.account}
              </text>
              <text fg={colors.textMuted}>{` [${stream.phase}]`}</text>
              <text fg={colors.warning}>{" \u25CF"}</text>
            </box>
            <text fg={colors.text}>{stream.text ? stream.text.slice(-500) : "\u2026"}</text>
          </box>
        )}
      </For>

      <Show when={synthesis()}>
        <box
          flexDirection="column"
          marginTop={1}
          border={["left"]}
          borderColor={colors.success}
          paddingLeft={1}
        >
          <text fg={colors.success} attributes={TextAttributes.BOLD}>Synthesis</text>
          <text fg={colors.text}>{synthesis()!.slice(0, 4000)}</text>
        </box>
      </Show>

      <Show when={error()}>
        <text fg={colors.error}>{`Error: ${error()}`}</text>
      </Show>

      <Show when={done()}>
        <text fg={colors.success} attributes={TextAttributes.BOLD}>{"\u2713 Council discussion complete"}</text>
        <Show when={synthesis()}>
          <text fg={colors.textMuted}>{"  Type a message to continue with this decision"}</text>
        </Show>
      </Show>
      <Show when={!done() && !error()}>
        <text fg={colors.warning}>{"\u25A0 Discussion in progress\u2026"}</text>
      </Show>
    </box>
  );
}

export function RetroMessageBlock(props: { state: RetroState; version?: number }) {
  const { colors } = useTheme();

  const wellItems = createMemo(() => { void props.version; return [...props.state.wellItems]; });
  const issueItems = createMemo(() => { void props.version; return [...props.state.issueItems]; });
  const actionItems = createMemo(() => { void props.version; return [...props.state.actionItems]; });
  const done = createMemo(() => { void props.version; return props.state.done; });
  const error = createMemo(() => { void props.version; return props.state.error; });

  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row">
        <text fg={colors.accent} attributes={TextAttributes.BOLD}>{"Retro: "}</text>
        <text fg={colors.text} attributes={TextAttributes.BOLD}>{props.state.topic}</text>
      </box>

      <Show when={wellItems().length > 0}>
        <box flexDirection="column" marginTop={1}>
          <text fg={colors.success} attributes={TextAttributes.BOLD}>{"What went well"}</text>
          <For each={wellItems()}>
            {(item) => (
              <box flexDirection="row" paddingLeft={1}>
                <text fg={colors.success}>{"\u2713 "}</text>
                <text fg={colors.textMuted}>{`${item.account}: `}</text>
                <text fg={colors.text}>{item.content.slice(0, 200)}</text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={issueItems().length > 0}>
        <box flexDirection="column" marginTop={1}>
          <text fg={colors.warning} attributes={TextAttributes.BOLD}>{"What didn't work"}</text>
          <For each={issueItems()}>
            {(item) => (
              <box flexDirection="row" paddingLeft={1}>
                <text fg={colors.warning}>{"\u2717 "}</text>
                <text fg={colors.textMuted}>{`${item.account}: `}</text>
                <text fg={colors.text}>{item.content.slice(0, 200)}</text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={actionItems().length > 0}>
        <box flexDirection="column" marginTop={1}>
          <text fg={colors.accent} attributes={TextAttributes.BOLD}>{"Action Items"}</text>
          <For each={actionItems()}>
            {(item) => (
              <box flexDirection="row" paddingLeft={1}>
                <text fg={colors.accent}>{"\u25B6 "}</text>
                <text fg={colors.text}>{item}</text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={error()}>
        <text fg={colors.error}>{`Error: ${error()}`}</text>
      </Show>

      <Show when={done()}>
        <text fg={colors.success} attributes={TextAttributes.BOLD}>{"\u2713 Retro complete"}</text>
      </Show>
      <Show when={!done() && !error()}>
        <text fg={colors.warning}>{"\u25A0 Collecting reflections\u2026"}</text>
      </Show>
    </box>
  );
}
