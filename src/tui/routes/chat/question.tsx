
import { createSignal } from "solid-js";
import { Show, For } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "../../context/theme.js";

export interface QuestionPromptProps {
  question: string;
  options?: string[];
  onAnswer: (answer: string) => void;
}

export function QuestionPrompt(props: QuestionPromptProps) {
  const { colors } = useTheme();
  const [answered, setAnswered] = createSignal<string | null>(null);
  const [freeText, setFreeText] = createSignal("");
  const [freeTextMode, setFreeTextMode] = createSignal(false);
  const [cursorPos, setCursorPos] = createSignal(0);

  const opts = () => props.options ?? [];
  const hasOther = () => opts().length > 0;

  function submit(answer: string) {
    if (answered() !== null) return;
    setAnswered(answer);
    props.onAnswer(answer);
  }

  useKeyboard((evt: any) => {
    if (answered() !== null) return;

    if (freeTextMode()) {
      if (evt.name === "escape") {
        setFreeTextMode(false);
        evt.stopPropagation(); return;
      }
      if (evt.name === "return") {
        const text = freeText().trim();
        if (text) submit(text);
        evt.stopPropagation(); return;
      }
      if (evt.name === "backspace") {
        const pos = cursorPos();
        if (pos > 0) {
          setFreeText((t) => t.slice(0, pos - 1) + t.slice(pos));
          setCursorPos(pos - 1);
        }
        evt.stopPropagation(); return;
      }
      if (evt.name === "space") {
        const pos = cursorPos();
        setFreeText((t) => t.slice(0, pos) + " " + t.slice(pos));
        setCursorPos(pos + 1);
        evt.stopPropagation(); return;
      }
      if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta) {
        const pos = cursorPos();
        setFreeText((t) => t.slice(0, pos) + evt.name + t.slice(pos));
        setCursorPos(pos + 1);
        evt.stopPropagation(); return;
      }
      evt.stopPropagation();
      return;
    }

    const options = opts();
    if (evt.name && evt.name.length === 1 && evt.name >= "1" && evt.name <= "9") {
      const idx = parseInt(evt.name, 10) - 1;
      if (idx < options.length) {
        submit(options[idx]);
        evt.stopPropagation(); return;
      }
      if (idx === options.length) {
        setFreeTextMode(true);
        evt.stopPropagation(); return;
      }
    }

    if (options.length === 0 && evt.name === "return") {
      setFreeTextMode(true);
      evt.stopPropagation(); return;
    }
  });

  return (
    <box
      flexDirection="column"
      border={true}
      borderColor={answered() !== null ? colors.success : colors.info}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      {}
      <text fg={colors.info} attributes={TextAttributes.BOLD}>
        {"\u2500 Question \u2500"}
      </text>

      {}
      <box marginTop={1}>
        <text fg={colors.text}>{props.question}</text>
      </box>

      {}
      <Show when={answered() !== null}>
        <box marginTop={1}>
          <text fg={colors.success} attributes={TextAttributes.BOLD}>{`Answer: ${answered()}`}</text>
        </box>
      </Show>

