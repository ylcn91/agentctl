import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme, listThemes, getTheme } from "../themes/index.js";

interface Props {
  onNavigate: (view: string) => void;
  onThemeChange: (themeId: string) => void;
}

export function ThemePicker({ onNavigate, onThemeChange }: Props) {
  const currentTheme = useTheme();
  const allThemes = listThemes();
  const [selectedIndex, setSelectedIndex] = useState(
    Math.max(0, allThemes.findIndex((t) => t.id === currentTheme.id))
  );
  const [previewId, setPreviewId] = useState(currentTheme.id);

  useInput((input, key) => {
    if (key.escape) {
      // Revert to current theme on cancel
      onThemeChange(currentTheme.id);
      onNavigate("dashboard");
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => {
        const next = Math.max(0, i - 1);
        setPreviewId(allThemes[next].id);
        onThemeChange(allThemes[next].id);
        return next;
      });
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedIndex((i) => {
        const next = Math.min(allThemes.length - 1, i + 1);
        setPreviewId(allThemes[next].id);
        onThemeChange(allThemes[next].id);
        return next;
      });
      return;
    }

    if (key.return) {
      // Confirm selection - theme is already applied and persisted by onThemeChange
      onNavigate("dashboard");
      return;
    }
  });

  const previewTheme = getTheme(previewId);
  const pc = previewTheme.colors;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Theme</Text>
        <Text color={pc.textMuted}>  j/k navigate  Enter confirm  Esc cancel</Text>
      </Box>

      <Box flexDirection="row">
        {/* Theme list */}
        <Box flexDirection="column" width={30}>
          {allThemes.map((t, idx) => {
            const isSelected = idx === selectedIndex;
            const isCurrent = t.id === currentTheme.id;
            return (
              <Box key={t.id}>
                <Text color={isSelected ? pc.primary : pc.textMuted}>
                  {isSelected ? "> " : "  "}
                </Text>
                <Text color={isSelected ? pc.text : pc.textMuted} bold={isSelected}>
                  {t.name}
                </Text>
                {isCurrent && <Text color={pc.success}> *</Text>}
              </Box>
            );
          })}
        </Box>

        {/* Live preview panel */}
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={pc.borderActive}
          paddingX={2}
          paddingY={1}
          marginLeft={2}
        >
          <Text bold color={pc.primary}>{previewTheme.name}</Text>
          <Text> </Text>
          <Text color={pc.text}>Normal text</Text>
          <Text color={pc.textMuted}>Muted text</Text>
          <Text color={pc.textStrong} bold>Strong text</Text>
          <Text> </Text>
          <Text color={pc.primary}>Primary</Text>
          <Text color={pc.primaryMuted}>Primary Muted</Text>
          <Text color={pc.success}>Success</Text>
          <Text color={pc.warning}>Warning</Text>
          <Text color={pc.error}>Error</Text>
          <Text color={pc.info}>Info</Text>
          <Text> </Text>
          <Box borderStyle="single" borderColor={pc.border} paddingX={1}>
            <Text color={pc.syntaxKeyword}>const </Text>
            <Text color={pc.text}>greeting </Text>
            <Text color={pc.text}>= </Text>
            <Text color={pc.syntaxString}>"hello"</Text>
            <Text color={pc.syntaxComment}> // sample</Text>
          </Box>
          <Text> </Text>
          <Text color={pc.diffAdd}>+ added line</Text>
          <Text color={pc.diffRemove}>- removed line</Text>
        </Box>
      </Box>
    </Box>
  );
}
