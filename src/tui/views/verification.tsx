import { createSignal, createEffect, on, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import { atomicRead } from "../../services/file-store.js";
import { getHubDir } from "../../paths.js";
import type { VerificationVerdict, VerificationResult } from "../../services/verification-council.js";

const VERDICT_LABELS: Record<VerificationVerdict, string> = {
  ACCEPT: "PASS", REJECT: "FAIL", ACCEPT_WITH_NOTES: "WARN",
};

function getVerificationCachePath(): string {
  return `${getHubDir()}/council-verifications.json`;
}

interface VerificationCache { verifications: VerificationResult[]; }

export function VerificationView() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const [results, setResults] = createSignal<VerificationResult[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [detailView, setDetailView] = createSignal(false);
  const [refreshTick, setRefreshTick] = createSignal(0);

  const VERDICT_COLORS: Record<VerificationVerdict, string | RGBA> = {
    ACCEPT: colors.success, REJECT: colors.error, ACCEPT_WITH_NOTES: colors.warning,
  };

  function confidenceColor(c: number): string | RGBA {
    if (c >= 0.8) return colors.success;
    if (c >= 0.5) return colors.warning;
    return colors.error;
  }

  async function load() {
    try {
      const cache = await atomicRead<VerificationCache>(getVerificationCachePath());
      if (cache && Array.isArray(cache.verifications)) setResults(cache.verifications);
    } catch {}
    setLoading(false);
  }

  onMount(() => { load(); });
  createEffect(on(() => refreshTick(), () => { setLoading(true); load(); }, { defer: true }));
  createEffect(on(() => nav.refreshTick, (tick) => { if (tick > 0) setRefreshTick((t) => t + 1); }, { defer: true }));

  useKeyboard((evt: any) => {
    if (evt.name === "up" || evt.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (evt.name === "down" || evt.name === "j") {
      const max = detailView()
        ? (results()[selectedIndex()]?.individualReviews.length ?? 1) - 1
        : results().length - 1;
      setSelectedIndex((i) => Math.min(max, i + 1));
    } else if (evt.name === "return") {
      if (!detailView() && results().length > 0) { setDetailView(true); setSelectedIndex(0); }
    } else if (evt.name === "r") {
      setRefreshTick((t) => t + 1);
    } else if (evt.name === "escape") {
      if (detailView()) { setDetailView(false); setSelectedIndex(0); }
      else route.navigate({ type: "dashboard" });
    } else { return; }
    evt.preventDefault(); evt.stopPropagation();
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading verification results...</text>}>
      <Show when={results().length === 0}>
        <box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <box flexDirection="row" marginBottom={1}><text attributes={TextAttributes.BOLD}>Verification View</text><text fg={colors.textMuted}>  [r]efresh [Esc]back</text></box>
          <text fg={colors.textMuted}>No verification results found.</text>
          <text fg={colors.textMuted}>Verified tasks will appear here after council review.</text>
        </box>
      </Show>

      <Show when={results().length > 0 && detailView()}>
        {(() => {
          const result = () => results()[selectedIndex()] ?? results()[0];
          return (
            <box flexDirection="column" paddingTop={1} paddingBottom={1}>
              <box flexDirection="row" marginBottom={1}><text attributes={TextAttributes.BOLD}>Verification Detail</text><text fg={colors.textMuted}>  [Esc]back</text></box>
              <box flexDirection="row" marginBottom={1}>
                <text attributes={TextAttributes.BOLD}>Verdict: </text>
                <text fg={VERDICT_COLORS[result().verdict]} attributes={TextAttributes.BOLD}>{result().verdict}</text>
                <text fg={colors.textMuted}> | Confidence: </text>
                <text fg={confidenceColor(result().confidence)}>{(result().confidence * 100).toFixed(0)}%</text>
              </box>
              <box flexDirection="column" marginBottom={1}>
                <text attributes={TextAttributes.BOLD}>Chairman Reasoning</text>
                <box marginLeft={2}><text>{result().chairmanReasoning}</text></box>
              </box>
              <Show when={result().notes.length > 0}>
                <box flexDirection="column" marginBottom={1}>
                  <text attributes={TextAttributes.BOLD}>Notes</text>
                  <For each={result().notes}>{(note) => <box marginLeft={2}><text fg={colors.warning}>- {note}</text></box>}</For>
                </box>
              </Show>
              <box flexDirection="column" marginBottom={1}>
                <text attributes={TextAttributes.BOLD}>Individual Reviews ({result().individualReviews.length})</text>
                <For each={result().individualReviews}>
                  {(review, idx) => {
                    const isSelected = () => idx() === selectedIndex();
                    return (
                      <box marginLeft={2} flexDirection="column">
                        <box flexDirection="row">
                          <text fg={isSelected() ? colors.text : colors.textMuted}>{isSelected() ? "> " : "  "}</text>
                          <text fg={VERDICT_COLORS[review.verdict]} attributes={TextAttributes.BOLD}>[{VERDICT_LABELS[review.verdict]}]</text>
                          <text> </text>
                          <text fg={isSelected() ? colors.text : undefined} attributes={isSelected() ? TextAttributes.BOLD : undefined}>{review.account}</text>
                          <text fg={colors.textMuted}> | </text>
                          <text fg={confidenceColor(review.confidence)}>{(review.confidence * 100).toFixed(0)}%</text>
                        </box>
                        <Show when={isSelected()}>
                          <box marginLeft={4} flexDirection="column">
                            <text>{review.reasoning}</text>
                            <Show when={review.strengths.length > 0}>
                              <text fg={colors.success}>Strengths:</text>
                              <For each={review.strengths}>{(s) => <text fg={colors.success}>  + {s}</text>}</For>
                            </Show>
                            <Show when={review.issues.length > 0}>
                              <text fg={colors.error}>Issues:</text>
                              <For each={review.issues}>{(s) => <text fg={colors.error}>  - {s}</text>}</For>
                            </Show>
                          </box>
                        </Show>
                      </box>
                    );
                  }}
                </For>
              </box>
              <box flexDirection="column">
                <text attributes={TextAttributes.BOLD}>Receipt</text>
                <box marginLeft={2} flexDirection="column">
                  <box flexDirection="row"><text fg={colors.textMuted}>Task ID:      </text><text>{result().receipt.taskId}</text></box>
                  <box flexDirection="row"><text fg={colors.textMuted}>Spec Hash:    </text><text fg={colors.primary}>{result().receipt.specHash.slice(0, 16)}...</text></box>
                  <box flexDirection="row"><text fg={colors.textMuted}>Timestamp:    </text><text>{result().receipt.timestamp}</text></box>
                </box>
              </box>
            </box>
          );
        })()}
      </Show>

      <Show when={results().length > 0 && !detailView()}>
        <box flexDirection="column" paddingTop={1} paddingBottom={1}>
          <box flexDirection="row" marginBottom={1}><text attributes={TextAttributes.BOLD}>Verification View</text><text fg={colors.textMuted}>  [Enter]detail [r]efresh [Esc]back</text></box>
          <For each={results()}>
            {(result, idx) => (
              <box flexDirection="row" marginLeft={1}>
                <text fg={idx() === selectedIndex() ? colors.text : colors.textMuted}>{idx() === selectedIndex() ? "> " : "  "}</text>
                <text fg={VERDICT_COLORS[result.verdict]} attributes={TextAttributes.BOLD}>[{VERDICT_LABELS[result.verdict]}]</text>
                <text> </text>
                <text fg={idx() === selectedIndex() ? colors.text : undefined}>{result.receipt.taskId}</text>
                <text fg={colors.textMuted}> | </text>
                <text fg={confidenceColor(result.confidence)}>{(result.confidence * 100).toFixed(0)}%</text>
                <text fg={colors.textMuted}> | {result.individualReviews.length} reviews</text>
                <text fg={colors.textMuted}> | {result.receipt.timestamp.slice(0, 16).replace("T", " ")}</text>
              </box>
            )}
          </For>
          <box marginTop={1} flexDirection="column">
            <text attributes={TextAttributes.BOLD} fg={colors.textMuted}>Summary</text>
            <box flexDirection="row" marginLeft={2}>
              <text fg={colors.success}>{results().filter((r) => r.verdict === "ACCEPT").length} accepted</text>
              <text fg={colors.textMuted}> | </text>
              <text fg={colors.warning}>{results().filter((r) => r.verdict === "ACCEPT_WITH_NOTES").length} with notes</text>
              <text fg={colors.textMuted}> | </text>
              <text fg={colors.error}>{results().filter((r) => r.verdict === "REJECT").length} rejected</text>
            </box>
          </box>
        </box>
      </Show>
    </Show>
  );
}
