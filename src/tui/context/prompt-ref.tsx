
import { createSignal } from "solid-js";
import { createSimpleContext } from "./helper.js";

export interface PromptHandle {
  focus(): void;
  blur(): void;
  setText(text: string): void;
}

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: () => {
    let handle: PromptHandle | undefined;
    const [text, setText] = createSignal("");

    return {
      register(h: PromptHandle) {
        handle = h;
      },

      unregister() {
        handle = undefined;
      },

      focus() {
        handle?.focus();
      },

      blur() {
        handle?.blur();
      },

      setText(value: string) {
        setText(value);
        handle?.setText(value);
      },

      get text() {
        return text();
      },

      onTextChange(value: string) {
        setText(value);
      },
    };
  },
});
