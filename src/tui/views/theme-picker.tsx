import { createSignal, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { useNav } from "../context/nav.js";

export function ThemePicker() {
  const { colors } = useTheme();
  const route = useRoute();
  const nav = useNav();

  const [selectedIndex, setSelectedIndex] = createSignal(0);

  useKeyboard((evt: any) => {
    if (evt.name === "escape") {
      route.navigate({ type: "dashboard" });
      evt.preventDefault(); evt.stopPropagation();
    } else if (evt.name === "return") {
      route.navigate({ type: "dashboard" });
      evt.preventDefault(); evt.stopPropagation();
    }
  });

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1}>
      <box marginBottom={1}>
        <text attributes={TextAttributes.BOLD}>Theme</text>
        <text fg={colors.textMuted}>  j/k navigate  Enter confirm  Esc cancel</text>
      </box>

      <box flexDirection="row">
        <box flexDirection="column" width={30}>
          <text fg={colors.textMuted}>Theme list will be available after themes migration completes.</text>
        </box>

        <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} marginLeft={2}>
          <text attributes={TextAttributes.BOLD} fg={colors.primary}>Current Theme Preview</text>
          <text> </text>
          <text fg={colors.text}>Normal text</text>
          <text fg={colors.textMuted}>Muted text</text>
          <text fg={colors.text} attributes={TextAttributes.BOLD}>Strong text</text>
          <text> </text>
          <text fg={colors.primary}>Primary</text>
          <text fg={colors.secondary}>Secondary</text>
          <text fg={colors.success}>Success</text>
          <text fg={colors.warning}>Warning</text>
          <text fg={colors.error}>Error</text>
          <text fg={colors.info}>Info</text>
          <text> </text>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={colors.syntaxKeyword}>const </text>
            <text fg={colors.text}>greeting </text>
            <text fg={colors.text}>= </text>
            <text fg={colors.syntaxString}>"hello"</text>
            <text fg={colors.syntaxComment}>{"// comment"}</text>
          </box>
          <text> </text>
          <text fg={colors.diffAdded}>+ added line</text>
          <text fg={colors.diffRemoved}>- removed line</text>
        </box>
      </box>
    </box>
  );
}
