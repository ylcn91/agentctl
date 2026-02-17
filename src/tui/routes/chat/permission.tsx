
import { createSignal } from "solid-js";
import { Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "../../context/theme.js";

export type PermissionDecision = "allow" | "deny" | "always";

export interface PermissionPromptProps {
  toolName: string;
  description: string;
  command?: string;
  onDecision: (decision: PermissionDecision) => void;
}

const alwaysAllowed = new Set<string>();

export function isAlwaysAllowed(toolName: string): boolean {
  return alwaysAllowed.has(toolName);
}

export function clearAlwaysAllowed() {
  alwaysAllowed.clear();
}

export function PermissionPrompt(props: PermissionPromptProps) {
  const { colors } = useTheme();
  const [decided, setDecided] = createSignal<PermissionDecision | null>(null);

  if (alwaysAllowed.has(props.toolName)) {
    queueMicrotask(() => props.onDecision("allow"));
    return (
      <box
        flexDirection="column"
        border={true}
        borderColor={colors.success}
        paddingX={2}
        paddingY={1}
        marginY={1}
      >
        <box flexDirection="row">
          <text fg={colors.success} attributes={TextAttributes.BOLD}>{`\u2500 ${props.toolName} `}</text>
          <text fg={colors.success}>(auto-allowed)</text>
        </box>
        <Show when={props.command}>
          <text fg={colors.text}>{props.command}</text>
        </Show>
      </box>
    );
  }

  function decide(decision: PermissionDecision) {
    if (decided() !== null) return;
    setDecided(decision);
    if (decision === "always") {
      alwaysAllowed.add(props.toolName);
    }
    props.onDecision(decision === "always" ? "allow" : decision);
  }

  useKeyboard((evt: any) => {
    if (decided() !== null) return;
    if (evt.name === "y") { decide("allow"); evt.stopPropagation(); }
    else if (evt.name === "n") { decide("deny"); evt.stopPropagation(); }
    else if (evt.name === "a") { decide("always"); evt.stopPropagation(); }
  });

  const borderColor = () => {
    const d = decided();
    if (d === null) return colors.warning;
    if (d === "deny") return colors.error;
    return colors.success;
  };

  const statusText = () => {
    const d = decided();
    if (d === null) return null;
    if (d === "deny") return "Denied";
    if (d === "always") return "Always Allowed";
    return "Allowed";
  };

  const statusColor = () => {
    const d = decided();
    if (d === "deny") return colors.error;
    return colors.success;
  };

  return (
    <box
      flexDirection="column"
      border={true}
      borderColor={borderColor()}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <box flexDirection="row">
        <text fg={borderColor()} attributes={TextAttributes.BOLD}>{`\u2500 ${props.toolName} `}</text>
      </box>
      <text fg={colors.text}>{props.description}</text>
      <Show when={props.command}>
        <text fg={colors.textMuted}>{props.command}</text>
      </Show>
      <Show when={decided() === null}>
        <box flexDirection="row" marginTop={1} gap={2}>
          <text fg={colors.success}>[y] Allow</text>
          <text fg={colors.error}>[n] Deny</text>
          <text fg={colors.info}>[a] Always Allow</text>
        </box>
      </Show>
      <Show when={statusText()}>
        <box marginTop={1}>
          <text fg={statusColor()} attributes={TextAttributes.BOLD}>{statusText()}</text>
        </box>
      </Show>
    </box>
  );
}
