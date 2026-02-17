import { createSignal, type Setter } from "solid-js";
import { createStore } from "solid-js/store";
import { createSimpleContext } from "./helper.js";
import { getTuiStatePath } from "../../paths.js";

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false);
    const [store, setStore] = createStore<Record<string, any>>({});
    const filePath = getTuiStatePath();

    Bun.file(filePath)
      .json()
      .then((data: any) => { setStore(data); })
      .catch(() => {})
      .finally(() => { setReady(true); });

    const result = {
      get ready() { return ready(); },
      get store() { return store; },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue);
        return [
          () => result.get(name),
          (next: Setter<T>) => { result.set(name, next); },
        ] as const;
      },
      get(key: string, defaultValue?: any) {
        return store[key] ?? defaultValue;
      },
      set(key: string, value: any) {
        setStore(key, value);
        Bun.write(filePath, JSON.stringify(store, null, 2));
      },
    };
    return result;
  },
});
