import { createSignal, onCleanup } from "solid-js";
import { useTheme } from "../context/theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner(props: { label?: string }) {
  const { colors } = useTheme();
  const [frame, setFrame] = createSignal(0);
  const timer = setInterval(() => {
    setFrame((f) => (f + 1) % FRAMES.length);
  }, 80);
  onCleanup(() => clearInterval(timer));

  return (
    <box flexDirection="row">
      <text fg={colors.primary}>{FRAMES[frame()]} </text>
      {props.label && <text fg={colors.textMuted}>{props.label}</text>}
    </box>
  );
}
