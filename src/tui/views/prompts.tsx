import { createSignal, onMount, Show, For, type Accessor } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../context/theme.js";
import { useRoute } from "../context/route.js";
import { loadPrompts, savePrompt, deletePrompt, searchPrompts, type SavedPrompt } from "../../services/prompt-library.js";

type Mode = "browse" | "search" | "view" | "add-title" | "add-content";

export function PromptLibrary() {
  const { colors } = useTheme();
  const route = useRoute();
  const [prompts, setPrompts] = createSignal<SavedPrompt[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [mode, setMode] = createSignal<Mode>("browse");
  const [inputBuffer, setInputBuffer] = createSignal("");
  const [newTitle, setNewTitle] = createSignal("");
  const [viewingPrompt, setViewingPrompt] = createSignal<SavedPrompt | null>(null);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  async function refresh(query?: string) {
    try {
      setSaveError(null);
      const data = query ? await searchPrompts(query) : await loadPrompts();
      setPrompts(data);
    } catch (e: any) {
      setSaveError(e.message ?? "Failed to load prompts");
    } finally {
      setLoading(false);
    }
  }

  onMount(() => { refresh(); });

  useKeyboard((evt: any) => {
    const m = mode();

    if (m === "search") {
      if (evt.name === "return") { refresh(inputBuffer()); setMode("browse"); setInputBuffer(""); }
      else if (evt.name === "escape") { setInputBuffer(""); setMode("browse"); refresh(); }
      else if (evt.name === "backspace") { setInputBuffer((b) => b.slice(0, -1)); }
      else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) { setInputBuffer((b) => b + evt.name); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (m === "add-title") {
      if (evt.name === "return" && inputBuffer().trim()) { setNewTitle(inputBuffer().trim()); setInputBuffer(""); setMode("add-content"); }
      else if (evt.name === "escape") { setInputBuffer(""); setMode("browse"); }
      else if (evt.name === "backspace") { setInputBuffer((b) => b.slice(0, -1)); }
      else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) { setInputBuffer((b) => b + evt.name); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (m === "add-content") {
      if (evt.name === "return" && inputBuffer().trim()) {
        savePrompt({ title: newTitle(), content: inputBuffer().trim() }).then(() => refresh()).catch((e: any) => setSaveError(e.message));
        setInputBuffer(""); setNewTitle(""); setMode("browse");
      } else if (evt.name === "escape") { setInputBuffer(""); setNewTitle(""); setMode("browse"); }
      else if (evt.name === "backspace") { setInputBuffer((b) => b.slice(0, -1)); }
      else if (evt.name && !evt.ctrl && !evt.meta && evt.name.length === 1) { setInputBuffer((b) => b + evt.name); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (m === "view") {
      if (evt.name === "escape" || evt.name === "return") { setViewingPrompt(null); setMode("browse"); }
      evt.preventDefault(); evt.stopPropagation();
      return;
    }

    if (evt.name === "up" || evt.name === "k") { setSelectedIndex((i) => Math.max(0, i - 1)); }
    else if (evt.name === "down" || evt.name === "j") { setSelectedIndex((i) => Math.min(prompts().length - 1, i + 1)); }
    else if (evt.name === "/" || evt.name === "s") { setMode("search"); setInputBuffer(""); }
    else if (evt.name === "return" && prompts()[selectedIndex()]) { setViewingPrompt(prompts()[selectedIndex()]); setMode("view"); }
    else if (evt.name === "a") { setMode("add-title"); setInputBuffer(""); }
    else if (evt.name === "d" && prompts()[selectedIndex()]) {
      deletePrompt(prompts()[selectedIndex()].id).then(() => {
        refresh();
        setSelectedIndex((i) => Math.min(i, prompts().length - 2));
      });
    } else if (evt.name === "escape") { route.navigate({ type: "dashboard" }); }
    else { return; }
    evt.preventDefault(); evt.stopPropagation();
  });

  return (
    <Show when={!loading()} fallback={<text fg={colors.textMuted}>Loading prompts...</text>}>
      <box flexDirection="column" paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" marginBottom={1}>
          <text attributes={TextAttributes.BOLD}>Prompt Library</text>
          <text fg={colors.textMuted}>  [/]search [a]dd [d]elete [Enter]view [Esc]back</text>
        </box>

        <Show when={saveError()}><text fg={colors.error}>Error: {saveError()}</text></Show>

        <Show when={mode() === "search"}>
          <box flexDirection="row" marginBottom={1}><text fg={colors.primary}>Search: </text><text>{inputBuffer()}</text><text fg={colors.textMuted}>_</text></box>
        </Show>
        <Show when={mode() === "add-title"}>
          <box flexDirection="row" marginBottom={1}><text fg={colors.primary}>Title: </text><text>{inputBuffer()}</text><text fg={colors.textMuted}>_</text></box>
        </Show>
        <Show when={mode() === "add-content"}>
          <box flexDirection="row" marginBottom={1}><text fg={colors.primary}>Content for "{newTitle()}": </text><text>{inputBuffer()}</text><text fg={colors.textMuted}>_</text></box>
        </Show>

        <Show when={mode() === "view" && viewingPrompt()}>
          {(prompt: Accessor<SavedPrompt>) => (
            <box flexDirection="column" marginBottom={1}>
              <text attributes={TextAttributes.BOLD} fg={colors.primary}>{prompt().title}</text>
              <Show when={prompt().tags && prompt().tags!.length > 0}>
                <text fg={colors.info}>Tags: #{prompt().tags!.join(" #")}</text>
              </Show>
              <box marginTop={1}><text>{prompt().content}</text></box>
              <text fg={colors.textMuted}>Used {prompt().usageCount} times | Press Esc to go back</text>
            </box>
          )}
        </Show>

        <Show when={mode() === "browse" && prompts().length === 0}>
          <text fg={colors.textMuted}>No prompts saved. Press [a] to add one.</text>
        </Show>

        <Show when={mode() === "browse" || mode() === "search"}>
          <For each={prompts()}>
            {(p, idx) => (
              <box flexDirection="row" marginLeft={1}>
                <text fg={idx() === selectedIndex() ? colors.text : colors.textMuted}>
                  {idx() === selectedIndex() ? "> " : "  "}
                </text>
                <text fg={idx() === selectedIndex() ? colors.text : undefined}>{p.title}</text>
                <Show when={p.tags && p.tags.length > 0}><text fg={colors.info}> #{p.tags!.join(" #")}</text></Show>
                <text fg={colors.textMuted}> ({p.usageCount} uses)</text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  );
}
