
import { Show, Switch, Match, createMemo } from "solid-js";
import { useTheme } from "../../../context/theme.js";
import { BlockTool, InlineTool, parseInput, truncate, type ToolRendererProps } from "./shared.js";

export function TaskTool(props: ToolRendererProps) {
  const { colors } = useTheme();
  const input = createMemo(() => parseInput(props.part.input));
  const description = createMemo(() => (input().description as string) ?? (input().subject as string) ?? "");
  const subagentType = createMemo(() => (input().subagent_type as string) ?? (input().skill as string) ?? "");
  const from = createMemo(() => (input().from as string) ?? "");
  const to = createMemo(() => (input().to as string) ?? (input().recipient as string) ?? "");
  const priority = createMemo(() => (input().priority as string) ?? "");

  const title = createMemo(() => {
    const type = subagentType();
    if (type) return `# ${type.charAt(0).toUpperCase() + type.slice(1)} Task`;
    return "# Task";
  });

  const delegationLabel = createMemo(() => {
    const f = from();
    const t = to();
    if (f && t) return `${f} \u2192 ${t}`;
    return f || t || "";
  });

  const inlineSummary = createMemo(() => {
    const type = subagentType() || "Task";
    const desc = description();
    return desc ? `${type} ${truncate(desc, 60)}` : type;
  });

  return (
    <Switch>
      <Match when={description() || subagentType()}>
        <BlockTool title={title()} part={props.part}>
          <box flexDirection="column" gap={1}>
            <Show when={delegationLabel()}>
              <text fg={colors.textMuted}>{delegationLabel()}</text>
            </Show>
            <Show when={description()}>
              <text fg={colors.text}>{truncate(description(), 200)}</text>
            </Show>
            <Show when={priority()}>
              <text fg={priority() === "P0" ? colors.error : priority() === "P1" ? colors.warning : colors.textMuted}>
                {`[${priority()}]`}
              </text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="#" pending="Delegating..." complete={subagentType() || description()} summary={inlineSummary()} part={props.part} />
      </Match>
    </Switch>
  );
}
