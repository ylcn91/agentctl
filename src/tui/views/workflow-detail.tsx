import { createSignal, onMount, Show, For, type Accessor } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";

interface WorkflowRun {
  id: string;
  workflow_name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  retro_id: string | null;
}

interface StepRun {
  id: string;
  step_id: string;
  status: string;
  assigned_to: string | null;
  started_at: string | null;
  completed_at: string | null;
  attempt: number;
  result: string | null;
}

interface EntireRetroEvidence {
  sessionId: string;
  participant: string;
  totalTokens: number;
  tokenBurnRate: number;
  filesModified: number;
  checkpointCount: number;
  durationMinutes: number;
}

export function WorkflowDetail(props: { runId: string }) {
  const { colors } = useTheme();
  const route = useRoute();
  const [run, setRun] = createSignal<WorkflowRun | null>(null);
  const [steps, setSteps] = createSignal<StepRun[]>([]);
  const [evidence, setEvidence] = createSignal<EntireRetroEvidence[]>([]);
  const [loading, setLoading] = createSignal(true);

  const stepStatusColors: Record<string, string | RGBA> = {
    pending: colors.warning, assigned: colors.primary, completed: colors.success,
    failed: colors.error, skipped: colors.textMuted,
  };

  const runStatusColors: Record<string, string | RGBA> = {
    pending: colors.warning, running: colors.primary, completed: colors.success,
    failed: colors.error, cancelled: colors.textMuted, retro_in_progress: colors.secondary,
  };

  onMount(async () => {
    try {
      const { WorkflowStore } = await import("../../services/workflow-store.js");
      const { getWorkflowDbPath } = await import("../../paths.js");
      const store = new WorkflowStore(getWorkflowDbPath());
      const r = store.getRun(props.runId);
      if (r) { setRun(r); setSteps(store.getStepRunsForRun(props.runId)); }
      store.close();

      try {
        const { atomicRead } = await import("../../services/file-store.js");
        const { getHubDir } = await import("../../paths.js");
        const evidencePath = `${getHubDir()}/retro-evidence-${props.runId}.json`;
        const raw = await atomicRead(evidencePath);
        if (raw) setEvidence(raw as any);
      } catch {}
    } catch {}
    setLoading(false);
  });

  useKeyboard((evt: any) => {
    if (evt.name === "escape") route.navigate({ type: "workflows" });
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading run details...</text>}>
      <Show when={run()} fallback={<text fg={colors.error}>Run not found: {props.runId}</text>}>
        {(r: Accessor<WorkflowRun>) => {
          const statusColor = () => runStatusColors[r().status] ?? colors.textMuted;
          const duration = () => {
            if (r().started_at && r().completed_at) {
              return `${Math.round((new Date(r().completed_at!).getTime() - new Date(r().started_at!).getTime()) / 1000)}s`;
            }
            return r().started_at ? "running..." : "-";
          };
          return (
            <box flexDirection="column" paddingTop={1} paddingBottom={1}>
              <box marginBottom={1}>
                <text attributes={TextAttributes.BOLD}>Workflow Run: </text><text>{r().workflow_name}</text>
                <text fg={colors.textMuted}>  [Esc]back</text>
              </box>
              <box flexDirection="column" marginBottom={1} marginLeft={2}>
                <text>ID: <text fg={colors.textMuted}>{r().id}</text></text>
                <text>Status: <text fg={statusColor()}>{r().status}</text></text>
                <text>Duration: <text fg={colors.textMuted}>{duration()}</text></text>
                <Show when={r().retro_id}><text>Retro: <text fg={colors.secondary}>{r().retro_id!.slice(0, 8)}</text></text></Show>
              </box>
              <box marginBottom={1}><text attributes={TextAttributes.BOLD}>Steps ({steps().length})</text></box>
              <For each={steps()}>
                {(step) => {
                  const color = stepStatusColors[step.status] ?? colors.textMuted;
                  const stepDuration = step.started_at && step.completed_at
                    ? `${Math.round((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000)}s` : null;
                  return (
                    <box marginLeft={2}>
                      <text fg={color}>[{step.status}]</text>
                      <text> {step.step_id}</text>
                      <Show when={step.assigned_to}><text fg={colors.secondary}> @{step.assigned_to}</text></Show>
                      <Show when={stepDuration}><text fg={colors.textMuted}> ({stepDuration})</text></Show>
                      <Show when={step.attempt > 1}><text fg={colors.warning}> attempt:{step.attempt}</text></Show>
                      <Show when={step.result && step.status !== "completed"}><text fg={colors.error}> {step.result}</text></Show>
                    </box>
                  );
                }}
              </For>
              <Show when={evidence().length > 0}>
                <box flexDirection="column" marginTop={1}>
                  <box marginBottom={1}><text attributes={TextAttributes.BOLD} fg={colors.secondary}>Entire.io Evidence</text></box>
                  <box marginLeft={2} flexDirection="column">
                    <box>
                      <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>{"Participant".padEnd(16)}</text>
                      <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>{"Tokens".padEnd(10)}</text>
                      <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>{"Burn Rate".padEnd(12)}</text>
                      <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>{"Files".padEnd(8)}</text>
                      <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Duration</text>
                    </box>
                    <For each={evidence()}>
                      {(ev) => (
                        <box>
                          <text>{ev.participant.padEnd(16)}</text>
                          <text fg={colors.primary}>{String(ev.totalTokens).padEnd(10)}</text>
                          <text fg={ev.tokenBurnRate > 2000 ? colors.error : ev.tokenBurnRate > 1000 ? colors.warning : colors.success}>
                            {`${ev.tokenBurnRate}/min`.padEnd(12)}
                          </text>
                          <text>{String(ev.filesModified).padEnd(8)}</text>
                          <text fg={colors.textMuted}>{ev.durationMinutes}m</text>
                        </box>
                      )}
                    </For>
                  </box>
                </box>
              </Show>
            </box>
          );
        }}
      </Show>
    </Show>
  );
}
