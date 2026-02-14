import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { getHubDir } from "../paths.js";
import { join } from "path";
import { useTheme } from "../themes/index.js";

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

interface Props {
  onNavigate: (view: string, detail?: any) => void;
}

export function WorkflowBoard({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [definitions, setDefinitions] = useState<WorkflowDef[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"definitions" | "runs">("definitions");

  const statusColors: Record<string, string> = {
    pending: colors.warning,
    running: colors.primary,
    completed: colors.success,
    failed: colors.error,
    cancelled: colors.textMuted,
    retro_in_progress: colors.primaryMuted,
  };

  useEffect(() => {
    (async () => {
      try {
        const { scanWorkflowDir } = await import("../services/workflow-parser.js");
        const dir = join(getHubDir(), "workflows");
        const defs = await scanWorkflowDir(dir);
        setDefinitions(defs);
      } catch {
        // No workflows directory
      }

      try {
        const { WorkflowStore } = await import("../services/workflow-store.js");
        const { getWorkflowDbPath } = await import("../paths.js");
        const store = new WorkflowStore(getWorkflowDbPath());
        const allRuns = store.listRuns();
        setRuns(allRuns.slice(0, 20));
        store.close();
      } catch {
        // No workflow DB
      }

      setLoading(false);
    })();
  }, []);

  const items = tab === "definitions" ? definitions : runs;

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (input === "1") {
      setTab("definitions");
      setSelectedIndex(0);
    } else if (input === "2") {
      setTab("runs");
      setSelectedIndex(0);
    } else if (key.return && tab === "runs" && runs[selectedIndex]) {
      onNavigate("workflow_detail", { runId: runs[selectedIndex].id });
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color={colors.textMuted}>Loading workflows...</Text>;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Workflows</Text>
        <Text color={colors.textMuted}>  [1]Definitions [2]Runs [Enter]detail [Esc]back</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={tab === "definitions" ? colors.primary : colors.textMuted} bold={tab === "definitions"}>
          Definitions ({definitions.length})
        </Text>
        <Text>  </Text>
        <Text color={tab === "runs" ? colors.primary : colors.textMuted} bold={tab === "runs"}>
          Runs ({runs.length})
        </Text>
      </Box>

      {tab === "definitions" && (
        <Box flexDirection="column">
          {definitions.length === 0 && (
            <Text color={colors.textMuted} dimColor>  No workflow definitions found</Text>
          )}
          {definitions.map((def, i) => {
            const isSelected = i === selectedIndex;
            return (
              <Box key={def.name} marginLeft={1}>
                <Text color={isSelected ? colors.text : colors.textMuted}>{isSelected ? "> " : "  "}</Text>
                <Text color={isSelected ? colors.text : undefined} bold={isSelected}>
                  {def.name}
                </Text>
                <Text color={colors.textMuted}> v{def.version} ({def.steps.length} steps)</Text>
                {def.retro && <Text color={colors.primaryMuted}> [retro]</Text>}
                {def.description && <Text color={colors.textMuted}> - {def.description}</Text>}
              </Box>
            );
          })}
        </Box>
      )}

      {tab === "runs" && (
        <Box flexDirection="column">
          {runs.length === 0 && (
            <Text color={colors.textMuted} dimColor>  No workflow runs</Text>
          )}
          {runs.map((run, i) => {
            const isSelected = i === selectedIndex;
            const statusColor = statusColors[run.status] ?? colors.textMuted;
            return (
              <Box key={run.id} marginLeft={1}>
                <Text color={isSelected ? colors.text : colors.textMuted}>{isSelected ? "> " : "  "}</Text>
                <Text color={isSelected ? colors.text : undefined}>{run.workflow_name}</Text>
                <Text color={statusColor}> [{run.status}]</Text>
                <Text color={colors.textMuted}> {run.id.slice(0, 8)}</Text>
                {run.started_at && <Text color={colors.textMuted}> {run.started_at.slice(0, 16)}</Text>}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
