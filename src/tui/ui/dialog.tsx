import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createContext, Show, useContext, type JSX, type ParentProps } from "solid-js";
import { createStore } from "solid-js/store";
import { useTheme } from "../context/theme.js";

function init() {
  const [store, setStore] = createStore({
    stack: [] as { element: JSX.Element; onClose?: () => void }[],
  });
  const renderer = useRenderer();

  useKeyboard((evt: any) => {
    if (store.stack.length === 0) return;
    if (evt.defaultPrevented) return;
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) {
      const current = store.stack.at(-1)!;
      current.onClose?.();
      setStore("stack", store.stack.slice(0, -1));
      evt.preventDefault();
      evt.stopPropagation();
    }
  });

  return {
    clear() {
      for (const item of store.stack) { item.onClose?.(); }
      setStore("stack", []);
    },
    replace(element: any, onClose?: () => void) {
      for (const item of store.stack) { item.onClose?.(); }
      setStore("stack", [{ element, onClose }]);
    },
    push(element: any, onClose?: () => void) {
      setStore("stack", [...store.stack, { element, onClose }]);
    },
    get stack() { return store.stack; },
    get active() { return store.stack.length > 0; },
    get current() { return store.stack.at(-1)?.element; },
  };
}

export type DialogContext = ReturnType<typeof init>;

const ctx = createContext<DialogContext>();

export function DialogProvider(props: ParentProps) {
  const value = init();
  const { colors } = useTheme();
  const dimensions = useTerminalDimensions();

  return (
    <ctx.Provider value={value}>
      {props.children}
      <Show when={value.active}>
        <box
          position="absolute"
          width={dimensions().width}
          height={dimensions().height}
          alignItems="center"
          paddingTop={Math.floor(dimensions().height / 4)}
          left={0}
          top={0}
        >
          <box
            width={60}
            maxWidth={dimensions().width - 2}
            backgroundColor={colors.backgroundPanel}
            border={["top", "bottom", "left", "right"]}
            borderColor={colors.border ?? colors.textMuted}
            paddingTop={1}
            paddingLeft={1}
            paddingRight={1}
            paddingBottom={1}
          >
            {value.current}
          </box>
        </box>
      </Show>
    </ctx.Provider>
  );
}

export function useDialog() {
  const value = useContext(ctx);
  if (!value) throw new Error("useDialog must be used within a DialogProvider");
  return value;
}
