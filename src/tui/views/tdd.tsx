import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes, RGBA } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useNav } from "../context/nav.js";
import { useRoute } from "../context/route.js";
import { TddEngine } from "../../services/tdd-engine.js";
import type { TddState, TddPhase } from "../../types.js";

const PHASE_LABELS: Record<TddPhase, string> = {
  idle: "IDLE", red: "RED", green: "GREEN", refactor: "REFACTOR",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TddView(props: { testFile?: string; watchMode?: boolean }) {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();
  const testFile = props.testFile ?? "test/**/*.test.ts";
  const [state, setState] = createSignal<TddState>({
    phase: "idle",
    testFile,
    cycles: [],
    lastTestOutput: "",
    lastTestPassed: false,
    startedAt: new Date().toISOString(),
  });
  const [running, setRunning] = createSignal(false);
  const [scrollOffset, setScrollOffset] = createSignal(0);

  const engine = new TddEngine({
    testFile,
    watchMode: props.watchMode,
    onStateChange: (s) => setState(s),
  });

  function phaseColor(phase: TddPhase): RGBA {
    if (phase === "red") return colors.error;
    if (phase === "green") return colors.success;
    if (phase === "refactor") return colors.warning;
    return colors.textMuted;
  }

  useKeyboard((evt: any) => {
    if (evt.defaultPrevented) return;
    if (evt.name === "escape") {
      engine.stop();
      route.navigate({ type: "dashboard" });
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }
    if (evt.name === "s") {
      if (state().phase === "idle") engine.start();
      evt.stopPropagation();
      return;
    }
    if (evt.name === "t") {
      if (state().phase !== "idle") {
        setRunning(true);
        engine.runTests().finally(() => setRunning(false));
      }
      evt.stopPropagation();
      return;
    }
    if (evt.name === "n") {
      const phase = state().phase;
      if (phase === "red") engine.transition("green");
      else if (phase === "green") engine.transition("refactor");
      else if (phase === "refactor") engine.transition("red");
      evt.stopPropagation();
      return;
    }
    if (evt.name === "x") {
      engine.stop();
      evt.stopPropagation();
      return;
    }
    if (evt.name === "j" || evt.name === "down") {
      setScrollOffset((o) => Math.max(0, o - 1));
      evt.stopPropagation();
    } else if (evt.name === "k" || evt.name === "up") {
      setScrollOffset((o) => o + 1);
      evt.stopPropagation();
    }
  });

  onCleanup(() => engine.stop());

  const outputLines = () => {
    const output = state().lastTestOutput;
    if (!output) return [];
    return output.split("\n");
  };

  return (
    <box flexDirection="column" paddingTop={1} paddingLeft={2} paddingRight={2} flexGrow={1}>
      <box flexDirection="row" gap={2}>
        <text attributes={TextAttributes.BOLD} fg={colors.text}>TDD Workflow</text>
        <text fg={phaseColor(state().phase)} attributes={TextAttributes.BOLD}>
          {PHASE_LABELS[state().phase]}
        </text>
        <Show when={running()}>
          <text fg={colors.info}>Running tests...</text>
        </Show>
      </box>

      <box marginTop={1} flexDirection="row" gap={2}>
        <text fg={colors.textMuted}>File:</text>
        <text fg={colors.text}>{state().testFile}</text>
      </box>

      <box marginTop={1} flexDirection="row" gap={2}>
        <text fg={colors.textMuted}>Last result:</text>
        <text fg={state().lastTestPassed ? colors.success : colors.error}>
          {state().lastTestPassed ? "PASS" : "FAIL"}
        </text>
      </box>

      <Show when={state().cycles.length > 0}>
        <box marginTop={1} flexDirection="column">
          <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Cycles</text>
          <For each={state().cycles.slice(-10)}>
            {(cycle) => (
              <box flexDirection="row" gap={1}>
                <text fg={phaseColor(cycle.phase)}>{PHASE_LABELS[cycle.phase].padEnd(10)}</text>
                <text fg={cycle.passed ? colors.success : colors.error}>
                  {cycle.passed ? "PASS" : cycle.passed === false ? "FAIL" : "---"}
                </text>
                <Show when={cycle.duration != null}>
                  <text fg={colors.textMuted}>{formatDuration(cycle.duration!)}</text>
                </Show>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={state().lastTestOutput}>
        <box marginTop={1} flexDirection="column" flexGrow={1}>
          <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Output</text>
          <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }}>
            <For each={outputLines()}>
              {(line) => <text fg={colors.text}>{line}</text>}
            </For>
          </scrollbox>
        </box>
      </Show>

      <box marginTop={1}>
        <text fg={colors.textMuted}>
          s start  t run tests  n next phase  x stop  j/k scroll  Esc back
        </text>
      </box>
    </box>
  );
}
