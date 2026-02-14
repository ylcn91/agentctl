import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

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

interface Props {
  runId: string;
  onNavigate: (view: string) => void;
}

const STEP_STATUS_COLORS: Record<string, string> = {
  pending: "yellow",
  assigned: "cyan",
  completed: "green",
  failed: "red",
  skipped: "gray",
};

export function WorkflowDetail({ runId, onNavigate }: Props) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [steps, setSteps] = useState<StepRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { WorkflowStore } = await import("../services/workflow-store.js");
        const { getWorkflowDbPath } = await import("../paths.js");
        const store = new WorkflowStore(getWorkflowDbPath());
        const r = store.getRun(runId);
        if (r) {
          setRun(r);
          setSteps(store.getStepRunsForRun(runId));
        }
        store.close();
      } catch {
        // DB not available
      }
      setLoading(false);
    })();
  }, [runId]);

  useInput((_input, key) => {
    if (key.escape) {
      onNavigate("workflows");
    }
  });

  if (loading) return <Text color="gray">Loading run details...</Text>;
  if (!run) return <Text color="red">Run not found: {runId}</Text>;

  const statusColor = {
    pending: "yellow",
    running: "cyan",
    completed: "green",
    failed: "red",
    cancelled: "gray",
    retro_in_progress: "magenta",
  }[run.status] ?? "gray";

  const duration = run.started_at && run.completed_at
    ? `${Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
    : run.started_at ? "running..." : "-";

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Workflow Run: </Text>
        <Text>{run.workflow_name}</Text>
        <Text color="gray">  [Esc]back</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1} marginLeft={2}>
        <Text>ID: <Text color="gray">{run.id}</Text></Text>
        <Text>Status: <Text color={statusColor}>{run.status}</Text></Text>
        <Text>Duration: <Text color="gray">{duration}</Text></Text>
        {run.retro_id && <Text>Retro: <Text color="magenta">{run.retro_id.slice(0, 8)}</Text></Text>}
      </Box>

      <Box marginBottom={1}>
        <Text bold>Steps ({steps.length})</Text>
      </Box>

      {steps.map((step) => {
        const color = STEP_STATUS_COLORS[step.status] ?? "gray";
        const stepDuration = step.started_at && step.completed_at
          ? `${Math.round((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000)}s`
          : null;
        return (
          <Box key={step.id} marginLeft={2}>
            <Text color={color}>[{step.status}]</Text>
            <Text> {step.step_id}</Text>
            {step.assigned_to && <Text color="magenta"> @{step.assigned_to}</Text>}
            {stepDuration && <Text color="gray"> ({stepDuration})</Text>}
            {step.attempt > 1 && <Text color="yellow"> attempt:{step.attempt}</Text>}
            {step.result && step.status !== "completed" && (
              <Text color="red"> {step.result}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
