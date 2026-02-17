
import { createSignal, For, Show, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { getHubDir } from "../../paths.js";
import { validateDAG, type WorkflowStep } from "../../services/workflow-parser.js";
import { stringify as stringifyYaml } from "yaml";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

type WizardStep = 1 | 2 | 3 | 4;
type OnFailure = "notify" | "retry" | "abort";

type ActiveInput = "name" | "description" | "step_id" | "step_title" | "step_assign" | "step_goal" | "none";

interface WizardStepDef {
  id: string;
  title: string;
  assign: string;
  goal: string;
  depends_on: string[];
}

interface WorkflowWizardProps {
  onClose: () => void;
  onCreated?: () => void;
}

export function WorkflowWizard(props: WorkflowWizardProps) {
  const { colors } = useTheme();

  const [step, setStep] = createSignal<WizardStep>(1);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [version, _setVersion] = createSignal(1);
  const [steps, setSteps] = createSignal<WizardStepDef[]>([]);
  const [onFailure, setOnFailure] = createSignal<OnFailure>("notify");
  const [maxRetries, setMaxRetries] = createSignal(0);
  const [retro, setRetro] = createSignal(false);
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal(false);

  const [activeInput, setActiveInput] = createSignal<ActiveInput>("name");

  const [stepCursor, setStepCursor] = createSignal(0);
  const [editingStep, setEditingStep] = createSignal(false);
  const [editId, setEditId] = createSignal("");
  const [editTitle, setEditTitle] = createSignal("");
  const [editAssign, setEditAssign] = createSignal("auto");
  const [editGoal, setEditGoal] = createSignal("");
  const [editField, setEditField] = createSignal<"step_id" | "step_title" | "step_assign" | "step_goal">("step_id");

  const [optionCursor, setOptionCursor] = createSignal(0);

  const yamlPreview = createMemo(() => {
    const wf = {
      name: name(),
      description: description() || undefined,
      version: version(),
      on_failure: onFailure(),
      max_retries: maxRetries() > 0 ? maxRetries() : undefined,
      retro: retro(),
      steps: steps().map((s) => ({
        id: s.id,
        title: s.title,
        assign: s.assign || "auto",
        depends_on: s.depends_on.length > 0 ? s.depends_on : undefined,
        handoff: { goal: s.goal },
      })),
    };
    try { return stringifyYaml(wf, { lineWidth: 80 }); }
    catch { return "# Error generating YAML"; }
  });

  const dagError = createMemo(() => {
    if (steps().length === 0) return "";
    try {
      const wfSteps: WorkflowStep[] = steps().map((s) => ({
        id: s.id,
        title: s.title,
        assign: s.assign || "auto",
        depends_on: s.depends_on.length > 0 ? s.depends_on : undefined,
        handoff: { goal: s.goal },
      }));
      validateDAG(wfSteps);
      return "";
    } catch (e: any) { return e.message; }
  });

  function saveWorkflow() {
    if (!name().trim() || steps().length === 0) {
      setError("Name and at least one step required");
      return;
    }
    if (dagError()) {
      setError(`DAG error: ${dagError()}`);
      return;
    }
    try {
      const dir = join(getHubDir(), "workflows");
      mkdirSync(dir, { recursive: true });
      const filename = name().trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".yaml";
      const filepath = join(dir, filename);
      writeFileSync(filepath, yamlPreview());
      setSuccess(true);
      setError("");
      props.onCreated?.();
    } catch (e: any) {
      setError(`Failed to save: ${e.message}`);
    }
  }

  function addNewStep() {
    setEditingStep(true);
    const idx = steps().length + 1;
    setEditId(`step-${idx}`);
    setEditTitle("");
    setEditAssign("auto");
    setEditGoal("");
    setEditField("step_id");
  }

  function saveEditingStep() {
    if (!editId().trim() || !editGoal().trim()) return;
    const newStep: WizardStepDef = {
      id: editId().trim(),
      title: editTitle().trim() || editId().trim(),
      assign: editAssign().trim() || "auto",
      goal: editGoal().trim(),
      depends_on: [],
    };

    const existing = steps().findIndex((s) => s.id === newStep.id);
    if (existing >= 0) {
      setSteps((prev) => prev.map((s, i) => i === existing ? newStep : s));
    } else {
      setSteps((prev) => [...prev, newStep]);
    }
    setEditingStep(false);
  }

  function handleTextInput(
    _getter: () => string,
    setter: (fn: (prev: string) => string) => void,
    evt: any,
  ): boolean {
    if (evt.name === "backspace") { setter((p) => p.slice(0, -1)); return true; }
    if (evt.name === "space") { setter((p) => p + " "); return true; }
    if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta) {
      setter((p) => p + evt.name);
      return true;
    }
    return false;
  }

  useKeyboard((evt: any) => {
    if (evt.name === "escape") {
      if (editingStep()) { setEditingStep(false); evt.stopPropagation(); return; }
      if (step() > 1) { setStep((s) => (s - 1) as WizardStep); evt.stopPropagation(); return; }
      props.onClose();
      evt.stopPropagation(); return;
    }

    const s = step();

    if (s === 1) {
      const field = activeInput();
      if (evt.name === "tab" || (evt.name === "return" && !evt.ctrl)) {
        if (field === "name") { setActiveInput("description"); }
        else { if (name().trim()) setStep(2); }
        evt.stopPropagation(); return;
      }
      if (evt.name === "up" && field === "description") {
        setActiveInput("name");
        evt.stopPropagation(); return;
      }
      if (field === "name") {
        if (handleTextInput(name, setName, evt)) { evt.stopPropagation(); return; }
      }
      if (field === "description") {
        if (handleTextInput(description, setDescription, evt)) { evt.stopPropagation(); return; }
      }
      evt.stopPropagation(); return;
    }

    if (s === 2) {
      if (editingStep()) {
        const ef = editField();
        if (evt.name === "tab" || (evt.name === "return" && !evt.ctrl)) {
          const order: typeof ef[] = ["step_id", "step_title", "step_assign", "step_goal"];
          const idx = order.indexOf(ef);
          if (idx < order.length - 1) { setEditField(order[idx + 1]); }
          else { saveEditingStep(); }
          evt.stopPropagation(); return;
        }
        if (ef === "step_id" && handleTextInput(editId, setEditId, evt)) { evt.stopPropagation(); return; }
        if (ef === "step_title" && handleTextInput(editTitle, setEditTitle, evt)) { evt.stopPropagation(); return; }
        if (ef === "step_assign" && handleTextInput(editAssign, setEditAssign, evt)) { evt.stopPropagation(); return; }
        if (ef === "step_goal" && handleTextInput(editGoal, setEditGoal, evt)) { evt.stopPropagation(); return; }
        evt.stopPropagation(); return;
      }

      if (evt.name === "n" || evt.name === "a") { addNewStep(); evt.stopPropagation(); return; }
      if (evt.name === "return" && steps().length > 0) { setStep(3); evt.stopPropagation(); return; }
      if (evt.name === "d" && steps().length > 0) {
        setSteps((prev) => prev.filter((_, i) => i !== stepCursor()));
        setStepCursor((c) => Math.max(0, c - 1));
        evt.stopPropagation(); return;
      }
      if (evt.name === "up" || evt.name === "k") {
        setStepCursor((c) => Math.max(0, c - 1));
        evt.stopPropagation(); return;
      }
      if (evt.name === "down" || evt.name === "j") {
        setStepCursor((c) => Math.min(steps().length - 1, c + 1));
        evt.stopPropagation(); return;
      }
      evt.stopPropagation(); return;
    }

    if (s === 3) {
      if (evt.name === "return" || evt.name === "tab") {
        setStep(4);
        evt.stopPropagation(); return;
      }
      if (evt.name === "up" || evt.name === "k") {
        setOptionCursor((c) => Math.max(0, c - 1));
        evt.stopPropagation(); return;
      }
      if (evt.name === "down" || evt.name === "j") {
        setOptionCursor((c) => Math.min(2, c + 1));
        evt.stopPropagation(); return;
      }
      if (evt.name === "space" || evt.name === "left" || evt.name === "right") {
        const oc = optionCursor();
        if (oc === 0) {
          const modes: OnFailure[] = ["notify", "retry", "abort"];
          const cur = modes.indexOf(onFailure());
          setOnFailure(modes[(cur + 1) % modes.length]);
        } else if (oc === 1) {
          setMaxRetries((r) => (r + 1) % 6);
        } else if (oc === 2) {
          setRetro((r) => !r);
        }
        evt.stopPropagation(); return;
      }
      evt.stopPropagation(); return;
    }

    if (s === 4) {
      if (evt.name === "return" || (evt.ctrl && evt.name === "s")) {
        saveWorkflow();
        evt.stopPropagation(); return;
      }
      evt.stopPropagation(); return;
    }
  });

  return (
    <box flexDirection="column" paddingX={2} paddingY={1}>
      <box flexDirection="row" gap={2}>
        <text attributes={TextAttributes.BOLD} fg={colors.text}>Workflow Wizard</text>
        <text fg={colors.textMuted}>Step {step()}/4</text>
      </box>

      <Show when={error()}>
        <text fg={colors.error} marginTop={1}>{error()}</text>
      </Show>

      <Show when={success()}>
        <box marginTop={1} flexDirection="column">
          <text fg={colors.success} attributes={TextAttributes.BOLD}>Workflow saved!</text>
          <box marginTop={1}>
            <text fg={colors.textMuted}>Esc to close</text>
          </box>
        </box>
      </Show>

      <Show when={!success()}>
        <Show when={step() === 1}>
          <box flexDirection="column" marginTop={1}>
            <box flexDirection="row">
              <text fg={activeInput() === "name" ? colors.primary : colors.textMuted}>
                {activeInput() === "name" ? "> " : "  "}
              </text>
              <text fg={colors.text}>Name: </text>
              <text fg={colors.primary}>{name()}<Show when={activeInput() === "name"}><text fg={colors.primary}>_</text></Show></text>
            </box>
            <box flexDirection="row" marginTop={1}>
              <text fg={activeInput() === "description" ? colors.primary : colors.textMuted}>
                {activeInput() === "description" ? "> " : "  "}
              </text>
              <text fg={colors.text}>Description: </text>
              <text fg={colors.primary}>{description()}<Show when={activeInput() === "description"}><text fg={colors.primary}>_</text></Show></text>
            </box>
            <box marginTop={1}>
              <text fg={colors.textMuted}>Tab/Enter next field  Esc back</text>
            </box>
          </box>
        </Show>

        <Show when={step() === 2}>
          <box flexDirection="column" marginTop={1}>
            <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Steps</text>

            <Show when={editingStep()}>
              <box flexDirection="column" marginTop={1} border={true} borderColor={colors.primary} paddingX={1} paddingY={1}>
                <text fg={colors.primary} attributes={TextAttributes.BOLD}>
                  {steps().some((s) => s.id === editId().trim()) ? "Edit Step" : "New Step"}
                </text>
                <box flexDirection="row" marginTop={1}>
                  <text fg={editField() === "step_id" ? colors.primary : colors.textMuted}>
                    {editField() === "step_id" ? "> " : "  "}
                  </text>
                  <text fg={colors.text}>ID: </text>
                  <text fg={colors.primary}>{editId()}<Show when={editField() === "step_id"}><text fg={colors.primary}>_</text></Show></text>
                </box>
                <box flexDirection="row">
                  <text fg={editField() === "step_title" ? colors.primary : colors.textMuted}>
                    {editField() === "step_title" ? "> " : "  "}
                  </text>
                  <text fg={colors.text}>Title: </text>
                  <text fg={colors.primary}>{editTitle()}<Show when={editField() === "step_title"}><text fg={colors.primary}>_</text></Show></text>
                </box>
                <box flexDirection="row">
                  <text fg={editField() === "step_assign" ? colors.primary : colors.textMuted}>
                    {editField() === "step_assign" ? "> " : "  "}
                  </text>
                  <text fg={colors.text}>Assign: </text>
                  <text fg={colors.primary}>{editAssign()}<Show when={editField() === "step_assign"}><text fg={colors.primary}>_</text></Show></text>
                </box>
                <box flexDirection="row">
                  <text fg={editField() === "step_goal" ? colors.primary : colors.textMuted}>
                    {editField() === "step_goal" ? "> " : "  "}
                  </text>
                  <text fg={colors.text}>Goal: </text>
                  <text fg={colors.primary}>{editGoal()}<Show when={editField() === "step_goal"}><text fg={colors.primary}>_</text></Show></text>
                </box>
                <box marginTop={1}>
                  <text fg={colors.textMuted}>Tab/Enter next field  Esc cancel</text>
                </box>
              </box>
            </Show>

            <Show when={!editingStep()}>
              <Show when={steps().length === 0}>
                <text fg={colors.textMuted} marginTop={1}>No steps yet. Press n to add one.</text>
              </Show>
              <For each={steps()}>
                {(s, i) => (
                  <box flexDirection="row" marginTop={i() === 0 ? 1 : 0}>
                    <text fg={i() === stepCursor() ? colors.primary : colors.textMuted}>
                      {i() === stepCursor() ? "> " : "  "}
                    </text>
                    <text fg={colors.text}>{s.id}</text>
                    <text fg={colors.textMuted}> — {s.title} ({s.assign})</text>
                  </box>
                )}
              </For>
              <Show when={dagError()}>
                <text fg={colors.error} marginTop={1}>{dagError()}</text>
              </Show>
              <box marginTop={1}>
                <text fg={colors.textMuted}>n add  d delete  j/k navigate  Enter next  Esc back</text>
              </box>
            </Show>
          </box>
        </Show>

        <Show when={step() === 3}>
          <box flexDirection="column" marginTop={1}>
            <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Options</text>
            <box flexDirection="row" marginTop={1}>
              <text fg={optionCursor() === 0 ? colors.primary : colors.textMuted}>
                {optionCursor() === 0 ? "> " : "  "}
              </text>
              <text fg={colors.text}>On Failure: </text>
              <text fg={colors.primary}>{onFailure()}</text>
            </box>
            <box flexDirection="row">
              <text fg={optionCursor() === 1 ? colors.primary : colors.textMuted}>
                {optionCursor() === 1 ? "> " : "  "}
              </text>
              <text fg={colors.text}>Max Retries: </text>
              <text fg={colors.primary}>{maxRetries()}</text>
            </box>
            <box flexDirection="row">
              <text fg={optionCursor() === 2 ? colors.primary : colors.textMuted}>
                {optionCursor() === 2 ? "> " : "  "}
              </text>
              <text fg={colors.text}>Retro: </text>
              <text fg={retro() ? colors.success : colors.textMuted}>{retro() ? "Yes" : "No"}</text>
            </box>
            <box marginTop={1}>
              <text fg={colors.textMuted}>Space toggle  j/k navigate  Enter/Tab next  Esc back</text>
            </box>
          </box>
        </Show>

        <Show when={step() === 4}>
          <box flexDirection="column" marginTop={1}>
            <text fg={colors.textMuted} attributes={TextAttributes.BOLD}>Preview</text>
            <box marginTop={1} flexDirection="column">
              <For each={yamlPreview().split("\n")}>
                {(line) => <text fg={colors.text}>{line}</text>}
              </For>
            </box>
            <box marginTop={1}>
              <text fg={colors.textMuted}>Enter save  Ctrl+S save  Esc back</text>
            </box>
          </box>
        </Show>
      </Show>
    </box>
  );
}