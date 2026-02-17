import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import { useAgentStreams } from "../../hooks/useAgentStreams.js";
import type { StreamChunk } from "../../hooks/useAgentStreams.js";
import { createStreamingConnection, type StreamingConnection } from "../../services/daemon-client-stream.js";
import { loadConfig } from "../../config.js";

const CHUNK_TYPE_STYLES: Record<string, { label: string; colorKey: string }> = {
  text: { label: "text", colorKey: "text" },
  thinking: { label: "think", colorKey: "primaryMuted" },
  tool_use: { label: "tool", colorKey: "warning" },
  tool_result: { label: "result", colorKey: "success" },
  error: { label: "error", colorKey: "error" },
  system: { label: "sys", colorKey: "textMuted" },
};

const MAX_VISIBLE_LINES = 200;

function getVisibleChunks(chunks: StreamChunk[], autoScroll: boolean, scrollOffset: number): StreamChunk[] {
  if (autoScroll) return chunks.slice(-MAX_VISIBLE_LINES);
  const start = Math.max(0, chunks.length - MAX_VISIBLE_LINES - scrollOffset);
  return chunks.slice(start, start + MAX_VISIBLE_LINES);
}

export function AgentActivity() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const agentStreams = useAgentStreams();
  const [selectedAgent, setSelectedAgent] = createSignal(0);
  const [autoScroll, setAutoScroll] = createSignal(true);
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [connected, setConnected] = createSignal(false);
  let connectionRef: StreamingConnection | null = null;

  onMount(() => {
    nav.setInputFocus("view");
    let cancelled = false;

    (async () => {
      try {
        const config = await loadConfig();
        const firstAccount = config.accounts[0];
        if (!firstAccount) return;
        const conn = await createStreamingConnection(
          firstAccount.name,
          ["AGENT_STREAM_*", "COUNCIL_SESSION_*"],
          agentStreams.handleEvent,
        );
        if (cancelled) { conn.close(); return; }
        connectionRef = conn;
        setConnected(true);
      } catch {}
    })();

    onCleanup(() => {
      cancelled = true;
      nav.setInputFocus("global");
      connectionRef?.close();
    });
  });

  useKeyboard((evt: any) => {
    if (nav.inputFocus !== "view") return;

    if (evt.name === "escape") {
      route.navigate({ type: "dashboard" });
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (evt.name === "k" || evt.name === "up") {
      setSelectedAgent((i) => Math.max(0, i - 1));
      setAutoScroll(true); setScrollOffset(0);
    } else if (evt.name === "j" || evt.name === "down") {
      setSelectedAgent((i) => Math.min(agentStreams.allStreams.length - 1, i + 1));
      setAutoScroll(true); setScrollOffset(0);
    } else if (evt.name === "pageup" || (evt.name === "u" && evt.ctrl)) {
      setAutoScroll(false); setScrollOffset((o) => Math.max(0, o - 10));
    } else if (evt.name === "pagedown" || (evt.name === "d" && evt.ctrl)) {
      setAutoScroll(false); setScrollOffset((o) => o + 10);
    } else if (evt.name === "f") {
      setAutoScroll(true); setScrollOffset(0);
    }
    evt.preventDefault(); evt.stopPropagation();
  });

  const selectedStream = () => agentStreams.allStreams[selectedAgent()] ?? null;

  const visibleChunks = () => {
    const stream = selectedStream();
    if (!stream) return [];
    return getVisibleChunks(stream.chunks, autoScroll(), scrollOffset());
  };

  const elapsed = () => {
    const stream = selectedStream();
    if (!stream) return 0;
    if (stream.status === "live" && stream.startedAt) {
      return Math.round((Date.now() - new Date(stream.startedAt).getTime()) / 1000);
    }
    return stream.durationMs ? Math.round(stream.durationMs / 1000) : 0;
  };

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" marginBottom={1}>
        <text attributes={TextAttributes.BOLD}>Agent Activity</text>
        <text fg={colors.textMuted}>  [j/k]select [PgUp/PgDn]scroll [f]follow [Esc]back</text>
        <Show when={!connected()}><text fg={colors.warning}> (offline)</text></Show>
      </box>

      <box flexDirection="row" minHeight={15}>
        <box flexDirection="column" width={24} paddingLeft={1} paddingRight={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.primary}>Active Agents</text>
          <Show when={agentStreams.allStreams.length === 0}>
            <text fg={colors.textMuted}>Waiting...</text>
          </Show>
          <For each={agentStreams.allStreams}>
            {(stream, idx) => {
              const isSelected = () => idx() === selectedAgent();
              const statusIcon = () => stream.status === "live" ? "\u25CF" : "\u25CB";
              const statusColor = () => stream.status === "live" ? colors.success : colors.textMuted;
              return (
                <box flexDirection="row">
                  <text fg={isSelected() ? colors.primary : colors.text}>{isSelected() ? "> " : "  "}</text>
                  <text fg={statusColor()}>{statusIcon()} </text>
                  <text fg={isSelected() ? colors.text : colors.textMuted}>{stream.account.slice(0, 16)}</text>
                </box>
              );
            }}
          </For>
        </box>

        <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
          <Show when={!selectedStream()} fallback={
            <>
              <box flexDirection="row" marginBottom={1}>
                <text attributes={TextAttributes.BOLD} fg={colors.primary}>{selectedStream()!.account}</text>
                <text fg={colors.textMuted}> ({selectedStream()!.provider})</text>
                <Show when={selectedStream()!.status === "live"}><text fg={colors.success}> LIVE</text></Show>
              </box>
              <For each={visibleChunks()}>
                {(chunk) => {
                  const style = CHUNK_TYPE_STYLES[chunk.chunkType] ?? CHUNK_TYPE_STYLES.text;
                  const color = (colors as Record<string, any>)[style.colorKey] ?? colors.text;
                  return (
                    <box flexDirection="row">
                      <text fg={color} attributes={TextAttributes.BOLD}>[{style.label.padEnd(6)}] </text>
                      <text fg={colors.text}>
                        {chunk.chunkType === "tool_use" && chunk.toolName
                          ? `${chunk.toolName}${chunk.toolInput ? ` ${chunk.toolInput.slice(0, 60)}` : ""}`
                          : chunk.content.slice(0, 120)}
                      </text>
                    </box>
                  );
                }}
              </For>
            </>
          }>
            <text fg={colors.textMuted}>Waiting for agent activity...</text>
          </Show>
        </box>
      </box>

      <box flexDirection="row" marginTop={1} paddingLeft={1} paddingRight={1}>
        <Show when={selectedStream()} fallback={<text fg={colors.textMuted}>No active streams</text>}>
          <text fg={colors.textMuted}>Tokens: {selectedStream()!.tokenCount ?? "--"}</text>
          <text fg={colors.textMuted}> | Cost: {selectedStream()!.cost != null ? `$${selectedStream()!.cost!.toFixed(4)}` : "--"}</text>
          <text fg={colors.textMuted}> | {elapsed()}s</text>
          <text fg={colors.textMuted}> | Chunks: {selectedStream()!.chunks.length}</text>
          <Show when={!autoScroll()}><text fg={colors.warning}> (scrolled -- press f to follow)</text></Show>
        </Show>
      </box>
    </box>
  );
}
