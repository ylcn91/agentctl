import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { loadPrompts, savePrompt, deletePrompt, searchPrompts, type SavedPrompt } from "../services/prompt-library.js";
import { useTheme } from "../themes/index.js";

interface Props {
  onNavigate: (view: string) => void;
}

type Mode = "browse" | "search" | "view" | "add-title" | "add-content";

export function PromptLibrary({ onNavigate }: Props) {
  const { colors } = useTheme();
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("browse");
  const [inputBuffer, setInputBuffer] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [viewingPrompt, setViewingPrompt] = useState<SavedPrompt | null>(null);

  async function refresh(query?: string) {
    try {
      const data = query ? await searchPrompts(query) : await loadPrompts();
      setPrompts(data);
    } catch (e: any) {
      console.error("[prompts]", e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useInput((input, key) => {
    if (mode === "search") {
      if (key.return) {
        refresh(inputBuffer);
        setMode("browse");
        setInputBuffer("");
      } else if (key.escape) {
        setInputBuffer("");
        setMode("browse");
        refresh();
      } else if (key.backspace || key.delete) {
        setInputBuffer((b) => b.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setInputBuffer((b) => b + input);
      }
      return;
    }

    if (mode === "add-title") {
      if (key.return && inputBuffer.trim()) {
        setNewTitle(inputBuffer.trim());
        setInputBuffer("");
        setMode("add-content");
      } else if (key.escape) {
        setInputBuffer("");
        setMode("browse");
      } else if (key.backspace || key.delete) {
        setInputBuffer((b) => b.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setInputBuffer((b) => b + input);
      }
      return;
    }

    if (mode === "add-content") {
      if (key.return && inputBuffer.trim()) {
        savePrompt({ title: newTitle, content: inputBuffer.trim() }).then(() => {
          refresh();
        });
        setInputBuffer("");
        setNewTitle("");
        setMode("browse");
      } else if (key.escape) {
        setInputBuffer("");
        setNewTitle("");
        setMode("browse");
      } else if (key.backspace || key.delete) {
        setInputBuffer((b) => b.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setInputBuffer((b) => b + input);
      }
      return;
    }

    if (mode === "view") {
      if (key.escape || key.return) {
        setViewingPrompt(null);
        setMode("browse");
      }
      return;
    }

    // Browse mode
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(prompts.length - 1, i + 1));
    } else if (input === "/" || input === "s") {
      setMode("search");
      setInputBuffer("");
    } else if (key.return && prompts[selectedIndex]) {
      setViewingPrompt(prompts[selectedIndex]);
      setMode("view");
    } else if (input === "a") {
      setMode("add-title");
      setInputBuffer("");
    } else if (input === "d" && prompts[selectedIndex]) {
      deletePrompt(prompts[selectedIndex].id).then(() => {
        refresh();
        setSelectedIndex((i) => Math.min(i, prompts.length - 2));
      });
    } else if (key.escape) {
      onNavigate("dashboard");
    }
  });

  if (loading) return <Text color={colors.textMuted}>Loading prompts...</Text>;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Prompt Library</Text>
        <Text color={colors.textMuted}>  [/]search [a]dd [d]elete [Enter]view [Esc]back</Text>
      </Box>

      {mode === "search" && (
        <Box marginBottom={1}>
          <Text color={colors.primary}>Search: </Text>
          <Text>{inputBuffer}</Text>
          <Text color={colors.textMuted}>_</Text>
        </Box>
      )}

      {mode === "add-title" && (
        <Box marginBottom={1}>
          <Text color={colors.primary}>Title: </Text>
          <Text>{inputBuffer}</Text>
          <Text color={colors.textMuted}>_</Text>
        </Box>
      )}

      {mode === "add-content" && (
        <Box marginBottom={1}>
          <Text color={colors.primary}>Content for "{newTitle}": </Text>
          <Text>{inputBuffer}</Text>
          <Text color={colors.textMuted}>_</Text>
        </Box>
      )}

      {mode === "view" && viewingPrompt && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={colors.primary}>{viewingPrompt.title}</Text>
          {viewingPrompt.tags && viewingPrompt.tags.length > 0 && (
            <Text color={colors.info}>Tags: #{viewingPrompt.tags.join(" #")}</Text>
          )}
          <Box marginTop={1}>
            <Text wrap="wrap">{viewingPrompt.content}</Text>
          </Box>
          <Text color={colors.textMuted} dimColor>Used {viewingPrompt.usageCount} times | Press Esc to go back</Text>
        </Box>
      )}

      {mode === "browse" && prompts.length === 0 && (
        <Text color={colors.textMuted}>No prompts saved. Press [a] to add one.</Text>
      )}

      {(mode === "browse" || mode === "search") && prompts.map((p, idx) => (
        <Box key={p.id} marginLeft={1}>
          <Text color={idx === selectedIndex ? colors.text : colors.textMuted}>
            {idx === selectedIndex ? "> " : "  "}
          </Text>
          <Text color={idx === selectedIndex ? colors.text : undefined}>
            {p.title}
          </Text>
          {p.tags && p.tags.length > 0 && (
            <Text color={colors.info}> #{p.tags.join(" #")}</Text>
          )}
          <Text color={colors.textMuted}> ({p.usageCount} uses)</Text>
        </Box>
      ))}
    </Box>
  );
}
