import { createContext, Show, useContext, type ParentProps, type Accessor } from "solid-js";
import { createStore } from "solid-js/store";
import { useTerminalDimensions } from "@opentui/solid";
import { useTheme } from "../context/theme.js";

export interface ToastOptions {
  message: string;
  title?: string;
  variant?: "info" | "success" | "warning" | "error";
  duration?: number;
}

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const toast = {
    show(options: ToastOptions) {
      const duration = options.duration ?? 3000;
      setStore("currentToast", options);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null);
      }, duration);
    },
    error(err: any) {
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      toast.show({ variant: "error", message });
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast;
    },
  };
  return toast;
}

export type ToastContext = ReturnType<typeof init>;

const ctx = createContext<ToastContext>();

export function Toast() {
  const toast = useToast();
  const { colors } = useTheme();
  const dimensions = useTerminalDimensions();

  const variantColor = (v?: string) => {
    switch (v) {
      case "success": return colors.success;
      case "warning": return colors.warning;
      case "error": return colors.error;
      default: return colors.info;
    }
  };

  return (
    <Show when={toast.currentToast}>
      {(current: Accessor<ToastOptions>) => (
        <box
          position="absolute"
          top={2}
          right={2}
          maxWidth={Math.min(60, dimensions().width - 6)}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={colors.backgroundPanel}
          flexDirection="row"
        >
          <Show when={current().title}>
            <text fg={colors.text}>{current().title} </text>
          </Show>
          <text fg={variantColor(current().variant)}>{current().message}</text>
        </box>
      )}
    </Show>
  );
}

export function ToastProvider(props: ParentProps) {
  const value = init();
  return (
    <ctx.Provider value={value}>
      {props.children}
      <Toast />
    </ctx.Provider>
  );
}

export function useToast() {
  const value = useContext(ctx);
  if (!value) throw new Error("useToast must be used within a ToastProvider");
  return value;
}
