import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import { fetchDelegationChains, type DelegationChainData } from "../../services/delegation-chain-loader.js";
import { DEFAULT_DELEGATION_DEPTH_CONFIG } from "../../services/delegation-depth.js";

const REFRESH_INTERVAL_MS = 10_000;

interface DelegationNode {
  agent: string;
  depth: number;
  blocked?: boolean;
  blockReason?: string;
}

function renderTree(chain: string[], maxDepth: number, blocked: boolean): DelegationNode[] {
  return chain.map((agent, i) => ({
    agent, depth: i,
    blocked: blocked && i === chain.length - 1,
    blockReason: blocked && i === chain.length - 1 ? `Depth ${i} at limit (max ${maxDepth})` : undefined,
  }));
}

export function DelegationChain() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const [chains, setChains] = createSignal<DelegationChainData[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [refreshTick, setRefreshTick] = createSignal(0);

  function depthColor(depth: number, maxDepth: number, blocked: boolean): string | RGBA {
    if (blocked) return colors.error;
    if (depth >= maxDepth - 1) return colors.warning;
    return colors.success;
  }

  async function load() {
    try { setChains(await fetchDelegationChains()); } catch {}
    setLoading(false);
  }

  onMount(() => { load(); });
  createEffect(on(() => refreshTick(), () => { load(); }, { defer: true }));
  createEffect(on(() => nav.refreshTick, (tick) => { if (tick > 0) setRefreshTick((t) => t + 1); }, { defer: true }));
  const interval = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));

  const maxDepth = DEFAULT_DELEGATION_DEPTH_CONFIG.maxDepth;

  useKeyboard((evt: any) => {
    if (evt.name === "up" || evt.name === "k") { setSelectedIndex((i) => Math.max(0, i - 1)); }
    else if (evt.name === "down" || evt.name === "j") { setSelectedIndex((i) => Math.min(chains().length - 1, i + 1)); }
    else if (evt.name === "r") { setRefreshTick((t) => t + 1); }
    else if (evt.name === "escape") { route.navigate({ type: "dashboard" }); }
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading delegation chains...</text>}>
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>Delegation Chains</text>
          <text fg={colors.textMuted}>  [r]efresh [up/down]navigate [Esc]back  </text>
          <text>{chains().length} chains</text>
          <text fg={colors.textMuted}> | </text>
          <text>max depth: {maxDepth}</text>
          <Show when={chains().filter((c) => c.blocked).length > 0}>
            <text fg={colors.textMuted}> | </text>
            <text fg={colors.error}>{chains().filter((c) => c.blocked).length} blocked</text>
          </Show>
        </box>

        <Show when={chains().length === 0}>
          <text fg={colors.textMuted}>No delegation chains recorded. Delegation events appear when agents hand off tasks to sub-agents.</text>
        </Show>

        <For each={chains()}>
          {(c, idx) => {
            const nodes = renderTree(c.chain, c.maxDepth, c.blocked);
            return (
              <box flexDirection="column" marginLeft={1} marginBottom={idx() < chains().length - 1 ? 1 : 0}>
                <box flexDirection="row">
                  <text fg={idx() === selectedIndex() ? colors.text : colors.textMuted}>
                    {idx() === selectedIndex() ? "> " : "  "}
                  </text>
                  <text attributes={idx() === selectedIndex() ? TextAttributes.BOLD : undefined}>task: {c.taskId.slice(0, 12)}</text>
                  <Show when={c.blocked}><text fg={colors.error}> BLOCKED</text></Show>
                </box>
                <For each={nodes}>
                  {(node, ni) => {
                    const prefix = ni() === 0 ? "" : "\u2514\u2500 ";
                    const padding = ni() === 0 ? "    " : "   ".repeat(node.depth - 1) + "    ";
                    const color = depthColor(node.depth, c.maxDepth, node.blocked ?? false);
                    return (
                      <box flexDirection="row" marginLeft={4}>
                        <text fg={colors.textMuted}>{ni() === 0 ? "" : padding}{prefix}</text>
                        <text fg={color}>{node.agent}</text>
                        <text fg={colors.textMuted}> (depth {node.depth}/{c.maxDepth})</text>
                        <Show when={node.blocked && node.blockReason}>
                          <text fg={colors.error}> - {node.blockReason}</text>
                        </Show>
                      </box>
                    );
                  }}
                </For>
              </box>
            );
          }}
        </For>
      </box>
    </Show>
  );
}
