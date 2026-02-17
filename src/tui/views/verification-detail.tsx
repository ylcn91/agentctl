import { Show, For } from "solid-js";
import { TextAttributes } from "@opentui/core";
import type { VerificationVerdict, VerificationResult } from "../../services/verification-council.js";

const VERDICT_LABELS: Record<VerificationVerdict, string> = {
  ACCEPT: "PASS", REJECT: "FAIL", ACCEPT_WITH_NOTES: "WARN",
};

export function VerificationDetail(props: {
  result: VerificationResult;
  selectedIndex: number;
  colors: Record<string, string>;
}) {
  const VERDICT_COLORS: Record<VerificationVerdict, string> = {
    ACCEPT: props.colors.success, REJECT: props.colors.error, ACCEPT_WITH_NOTES: props.colors.warning,
  };

  function confidenceColor(c: number): string {
    if (c >= 0.8) return props.colors.success;
    if (c >= 0.5) return props.colors.warning;
    return props.colors.error;
  }

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <box marginBottom={1}>
        <text attributes={TextAttributes.BOLD}>Verification Detail</text>
        <text fg={props.colors.textMuted}>  [Esc]back</text>
      </box>

      <box marginBottom={1}>
        <text attributes={TextAttributes.BOLD}>Verdict: </text>
        <text fg={VERDICT_COLORS[props.result.verdict]} attributes={TextAttributes.BOLD}>{props.result.verdict}</text>
        <text fg={props.colors.textMuted}> | Confidence: </text>
        <text fg={confidenceColor(props.result.confidence)}>{(props.result.confidence * 100).toFixed(0)}%</text>
      </box>

      <box flexDirection="column" marginBottom={1}>
        <text attributes={TextAttributes.BOLD}>Chairman Reasoning</text>
        <box marginLeft={2}><text>{props.result.chairmanReasoning}</text></box>
      </box>

      <Show when={props.result.notes.length > 0}>
        <box flexDirection="column" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>Notes</text>
          <For each={props.result.notes}>
            {(note) => <box marginLeft={2}><text fg={props.colors.warning}>- {note}</text></box>}
          </For>
        </box>
      </Show>

      <box flexDirection="column" marginBottom={1}>
        <text attributes={TextAttributes.BOLD}>Individual Reviews ({props.result.individualReviews.length})</text>
        <For each={props.result.individualReviews}>
          {(review, idx) => {
            const isSelected = () => idx() === props.selectedIndex;
            return (
              <box marginLeft={2} flexDirection="column">
                <box>
                  <text fg={isSelected() ? props.colors.text : props.colors.textMuted}>{isSelected() ? "> " : "  "}</text>
                  <text fg={VERDICT_COLORS[review.verdict]} attributes={TextAttributes.BOLD}>[{VERDICT_LABELS[review.verdict]}]</text>
                  <text> </text>
                  <text fg={isSelected() ? props.colors.text : undefined} attributes={isSelected() ? TextAttributes.BOLD : undefined}>{review.account}</text>
                  <text fg={props.colors.textMuted}> | </text>
                  <text fg={confidenceColor(review.confidence)}>{(review.confidence * 100).toFixed(0)}%</text>
                </box>
                <Show when={isSelected()}>
                  <box marginLeft={4} flexDirection="column">
                    <text>{review.reasoning}</text>
                    <Show when={review.strengths.length > 0}>
                      <text fg={props.colors.success}>Strengths:</text>
                      <For each={review.strengths}>{(s) => <text fg={props.colors.success}>  + {s}</text>}</For>
                    </Show>
                    <Show when={review.issues.length > 0}>
                      <text fg={props.colors.error}>Issues:</text>
                      <For each={review.issues}>{(s) => <text fg={props.colors.error}>  - {s}</text>}</For>
                    </Show>
                  </box>
                </Show>
              </box>
            );
          }}
        </For>
      </box>

      <Show when={props.result.peerEvaluations.length > 0}>
        <box flexDirection="column" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>Peer Evaluations ({props.result.peerEvaluations.length})</text>
          <For each={props.result.peerEvaluations}>
            {(pe) => (
              <box marginLeft={2} flexDirection="column">
                <box>
                  <text fg={props.colors.textMuted}>  </text>
                  <text>{pe.reviewer}</text>
                  <text fg={props.colors.textMuted}> ranked: [{pe.ranking.join(", ")}]</text>
                </box>
                <box marginLeft={4}><text fg={props.colors.textMuted}>{pe.reasoning}</text></box>
              </box>
            )}
          </For>
        </box>
      </Show>

      <box flexDirection="column">
        <text attributes={TextAttributes.BOLD}>Receipt</text>
        <box marginLeft={2} flexDirection="column">
          <box><text fg={props.colors.textMuted}>Task ID:      </text><text>{props.result.receipt.taskId}</text></box>
          <box><text fg={props.colors.textMuted}>Spec Hash:    </text><text fg={props.colors.primary}>{props.result.receipt.specHash.slice(0, 16)}...</text></box>
          <box><text fg={props.colors.textMuted}>Evidence Hash: </text><text fg={props.colors.primary}>{props.result.receipt.evidenceHash.slice(0, 16)}...</text></box>
          <box><text fg={props.colors.textMuted}>Timestamp:    </text><text>{props.result.receipt.timestamp}</text></box>
        </box>
      </box>
    </box>
  );
}
