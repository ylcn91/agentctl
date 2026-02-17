import { useRenderer } from "@opentui/solid";
import { createSimpleContext } from "./helper.js";

type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void;
    clear: () => void;
    get: () => string | undefined;
  };
};

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer();
    let message: string | undefined;
    const store = {
      set(value?: string) {
        const prev = message;
        message = value;
        return () => { message = prev; };
      },
      clear() { message = undefined; },
      get() { return message; },
    };
    const exit: Exit = Object.assign(
      async (reason?: unknown) => {
        renderer.setTerminalTitle("");
        renderer.destroy();
        await input.onExit?.();
        if (reason) {
          const msg = reason instanceof Error ? reason.message : String(reason);
          process.stderr.write(msg + "\n");
        }
        const text = store.get();
        if (text) process.stdout.write(text + "\n");
        process.exit(0);
      },
      { message: store },
    );
    return exit;
  },
});
