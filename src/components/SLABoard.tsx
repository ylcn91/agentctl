import { useState, useEffect, useContext } from "react";
import { Box, Text, useInput } from "ink";
import { NavContext } from "../app.js";
import { useTheme } from "../themes/index.js";
import { loadTasks } from "../services/tasks.js";
import { checkStaleTasks, humanTime, DEFAULT_SLA_CONFIG, type Escalation, type AdaptiveEscalation, type EntireTriggerType } from "../services/sla-engine.js";
import { useListNavigation } from "../hooks/useListNavigation.js";

const REFRESH_INTERVAL_MS = 30_000;

interface Props {
  onNavigate: (view: string) => void;
}

// ACTION_COLORS moved inside component to use theme

const ACTION_LABELS: Record<string, string> = {
  escalate: "🚨 ESCALATE",
  reassign_suggestion: "⚠️  REASSIGN",
  ping: "⏰ PING",
  suggest_reassign: "⚠️  SUGGEST REASSIGN",
  auto_reassign: "🔄 AUTO REASSIGN",
  escalate_human: "🆘 ESCALATE HUMAN",
  terminate: "⛔ TERMINATE",
};

const TRIGGER_LABELS: Record<EntireTriggerType, string> = {
  token_burn_rate: "[token-burn]",
  no_checkpoint: "[no-checkpoint]",
  context_saturation: "[saturation]",
  session_ended_incomplete: "[session-ended]",
};

export function SLABoard({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [escalations, setEscalations] = useState<Escalation[]>([]);

  const ACTION_COLORS: Record<string, string> = {
    escalate: colors.error,
    reassign_suggestion: colors.warning,
    ping: colors.primary,
    suggest_reassign: colors.warning,
    auto_reassign: colors.error,
    escalate_human: colors.error,
    terminate: colors.error,
  };
  const [adaptiveEscalations, setAdaptiveEscalations] = useState<AdaptiveEscalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const totalItems = escalations.length + adaptiveEscalations.length;

  const { selectedIndex } = useListNavigation({
    itemCount: totalItems,
    enabled: true,
  });

  const { setGlobalNavEnabled, refreshTick: globalRefresh } = useContext(NavContext);

  useEffect(() => {
    setGlobalNavEnabled(false);
    return () => setGlobalNavEnabled(true);
  }, [setGlobalNavEnabled]);

  // Respond to global Ctrl+r refresh
  useEffect(() => {
    if (globalRefresh > 0) setRefreshTick((prev) => prev + 1);
  }, [globalRefresh]);

  // Auto-refresh polling
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTick((prev) => prev + 1);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const board = await loadTasks();
        const escs = checkStaleTasks(board.tasks, DEFAULT_SLA_CONFIG);
        setEscalations(escs);
      } catch (e: any) {
        console.error("[sla-board]", e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refreshTick]);

  useInput((input, key) => {
    if (input === "r") {
      setRefreshTick((prev) => prev + 1);
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color={colors.textMuted}>Loading SLA data...</Text>;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>SLA Board</Text>
        <Text color={colors.textMuted}>  [r]efresh [Esc]back</Text>
      </Box>

      {totalItems === 0 ? (
        <Text color={colors.success}>No stale tasks — all within SLA thresholds.</Text>
      ) : (
        <>
          {escalations.map((esc, idx) => (
            <Box key={esc.taskId} marginLeft={1}>
              <Text color={idx === selectedIndex ? colors.text : colors.textMuted}>
                {idx === selectedIndex ? "> " : "  "}
              </Text>
              <Text color={ACTION_COLORS[esc.action] ?? colors.text}>
                {ACTION_LABELS[esc.action] ?? esc.action}
              </Text>
              <Text> </Text>
              <Text color={colors.textMuted}>[time-sla] </Text>
              <Text color={idx === selectedIndex ? colors.text : undefined}>
                {esc.taskTitle}
              </Text>
              <Text color={colors.textMuted}> | {humanTime(esc.staleForMs)} stale</Text>
              {esc.assignee && <Text color={colors.primaryMuted}> @{esc.assignee}</Text>}
            </Box>
          ))}
          {adaptiveEscalations.map((esc, idx) => {
            const globalIdx = escalations.length + idx;
            return (
              <Box key={`${esc.taskId}-${esc.trigger.type}`} marginLeft={1}>
                <Text color={globalIdx === selectedIndex ? colors.text : colors.textMuted}>
                  {globalIdx === selectedIndex ? "> " : "  "}
                </Text>
                <Text color={ACTION_COLORS[esc.action] ?? colors.text}>
                  {ACTION_LABELS[esc.action] ?? esc.action}
                </Text>
                <Text> </Text>
                <Text color={colors.textMuted}>{TRIGGER_LABELS[esc.trigger.type] ?? `[${esc.trigger.type}]`} </Text>
                <Text color={globalIdx === selectedIndex ? colors.text : undefined}>
                  {esc.taskTitle}
                </Text>
                <Text color={colors.textMuted}> | {esc.trigger.detail}</Text>
                {esc.assignee && <Text color={colors.primaryMuted}> @{esc.assignee}</Text>}
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}
