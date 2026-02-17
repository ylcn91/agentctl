import { createSignal, onMount, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { getHubDir } from "../../paths.js";
import { join } from "path";
import { WorkflowWizard } from "./workflow-wizard.js";

interface WorkflowDef {
  name: string;
  description?: string;
  version: number;
  retro: boolean;
  steps: Array<{ id: string; title: string }>;
}

interface WorkflowRun {
  id: string;
  workflow_name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export function WorkflowBoard() {
  const { colors } = useTheme();
  const route = useRoute();
  const [definitions, setDefinitions] = createSignal<WorkflowDef[]>([]);
  const [runs, setRuns] = createSignal<WorkflowRun[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [tab, setTab] = createSignal<"definitions" | "runs">("definitions");
  const [showWizard, setShowWizard] = createSignal(false);

  const statusColors: Record<string, string | RGBA> = {
    pending: colors.warning,
    running: colors.primary,
    completed: colors.success,
    failed: colors.error,
    cancelled: colors.textMuted,
    retro_in_progress: colors.secondary,
  };

  onMount(async () => {
    try {
      const { scanWorkflowDir } = await import("../../services/workflow-parser.js");
      const dir = join(getHubDir(), "workflows");
      const defs = await scanWorkflowDir(dir);
      setDefinitions(defs);
    } catch {}

    try {
      const { WorkflowStore } = await import("../../services/workflow-store.js");
      const { getWorkflowDbPath } = await import("../../paths.js");
      const store = new WorkflowStore(getWorkflowDbPath());
      const allRuns = store.listRuns();
      setRuns(allRuns.slice(0, 20));
      store.close();
    } catch {}

    setLoading(false);
  });

  useKeyboard((evt: any) => {
    if (showWizard()) return;
    const items = tab() === "definitions" ? definitions() : runs();
    if (evt.name === "n") {
      setShowWizard(true);
      evt.preventDefault(); evt.stopPropagation(); return;
    }
    if (evt.name === "up" || evt.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (evt.name === "down" || evt.name === "j") {
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (evt.name === "1") {
      setTab("definitions"); setSelectedIndex(0);
    } else if (evt.name === "2") {
      setTab("runs"); setSelectedIndex(0);
    } else if (evt.name === "return" && tab() === "runs" && runs()[selectedIndex()]) {
      route.navigate({ type: "workflow_detail", runId: runs()[selectedIndex()].id });
    } else if (evt.name === "escape") {
      route.navigate({ type: "dashboard" });
    } else { return; }
    evt.preventDefault(); evt.stopPropagation();
  });

  async function refreshDefinitions() {
    try {
      const { scanWorkflowDir } = await import("../../services/workflow-parser.js");
      const dir = join(getHubDir(), "workflows");
      const defs = await scanWorkflowDir(dir);
      setDefinitions(defs);
    } catch {}
  }

  return (
    <box flexDirection="column">
    <Show when={showWizard()}>
      <WorkflowWizard
        onClose={() => setShowWizard(false)}
        onCreated={() => { refreshDefinitions(); }}
      />
    </Show>
    <Show when={!showWizard()}>
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading workflows...</text>}>
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>Workflows</text>
          <text fg={colors.textMuted}>  [1]Definitions [2]Runs [n]Create [Enter]detail [Esc]back</text>
        </box>

        <box flexDirection="row" marginBottom={1}>
          <text fg={tab() === "definitions" ? colors.primary : colors.textMuted} attributes={tab() === "definitions" ? TextAttributes.BOLD : undefined}>
            Definitions ({definitions().length})
          </text>
          <text>  </text>
          <text fg={tab() === "runs" ? colors.primary : colors.textMuted} attributes={tab() === "runs" ? TextAttributes.BOLD : undefined}>
            Runs ({runs().length})
          </text>
        </box>

        <Show when={tab() === "definitions"}>
          <box flexDirection="column">
            <Show when={definitions().length === 0}>
              <text fg={colors.textMuted}>  No workflow definitions found</text>
            </Show>
            <For each={definitions()}>
              {(def, i) => {
                const isSelected = () => i() === selectedIndex();
                return (
                  <box flexDirection="row" marginLeft={1}>
                    <text fg={isSelected() ? colors.text : colors.textMuted}>{isSelected() ? "> " : "  "}</text>
                    <text fg={isSelected() ? colors.text : undefined} attributes={isSelected() ? TextAttributes.BOLD : undefined}>{def.name}</text>
                    <text fg={colors.textMuted}> v{def.version} ({def.steps.length} steps)</text>
                    <Show when={def.retro}><text fg={colors.secondary}> [retro]</text></Show>
                    <Show when={def.description}><text fg={colors.textMuted}> - {def.description}</text></Show>
                  </box>
                );
              }}
            </For>
          </box>
        </Show>

        <Show when={tab() === "runs"}>
          <box flexDirection="column">
            <Show when={runs().length === 0}>
              <text fg={colors.textMuted}>  No workflow runs</text>
            </Show>
            <For each={runs()}>
              {(run, i) => {
                const isSelected = () => i() === selectedIndex();
                const statusColor = () => statusColors[run.status] ?? colors.textMuted;
                return (
                  <box flexDirection="row" marginLeft={1}>
                    <text fg={isSelected() ? colors.text : colors.textMuted}>{isSelected() ? "> " : "  "}</text>
                    <text fg={isSelected() ? colors.text : undefined}>{run.workflow_name}</text>
                    <text fg={statusColor()}> [{run.status}]</text>
                    <text fg={colors.textMuted}> {run.id.slice(0, 8)}</text>
                    <Show when={run.started_at}><text fg={colors.textMuted}> {run.started_at!.slice(0, 16)}</text></Show>
                  </box>
                );
              }}
            </For>
          </box>
        </Show>
      </box>
    </Show>
    </Show>
    </box>
  );
}
