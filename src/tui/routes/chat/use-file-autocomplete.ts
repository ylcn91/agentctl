
import { createSignal, batch } from "solid-js";
import type { Overlay } from "./helpers.js";

const FILE_GLOB = new Bun.Glob("**/*");
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", ".next", "coverage"]);
const MAX_RESULTS = 50;

export interface FileAutocomplete {
  showFileDropdown: () => boolean;
  atPos: () => number | null;
  setAtPos: (v: number | null) => void;
  fileResults: () => string[];
  fileSelected: () => number;
  setFileSelected: (v: number | ((prev: number) => number)) => void;
  searchFiles: (query: string) => void;
  completeFileSelection: () => void;
  getAtQuery: () => string;
}

export function createFileAutocomplete(deps: {
  cursorPos: () => number;
  inputBuffer: () => string;
  overlay: () => Overlay;
  setInputBuffer: (v: string) => void;
  setCursorPos: (v: number) => void;
  setOverlay: (v: Overlay) => void;
}): FileAutocomplete {
  const [atPos, setAtPos] = createSignal<number | null>(null);
  const [fileResults, setFileResults] = createSignal<string[]>([]);
  const [fileSelected, setFileSelected] = createSignal(0);

  function showFileDropdown(): boolean {
    return deps.overlay() === "files" && atPos() !== null;
  }

  function searchFiles(query: string) {
    try {
      const results: string[] = [];
      const q = query.toLowerCase();
      for (const entry of FILE_GLOB.scanSync({ cwd: process.cwd(), onlyFiles: true })) {
        const parts = entry.split("/");
        if (parts.some((p) => IGNORE_DIRS.has(p))) continue;
        if (!q || entry.toLowerCase().includes(q)) {
          results.push(entry);
          if (results.length >= MAX_RESULTS) break;
        }
      }
      setFileResults(results);
      setFileSelected(0);
    } catch {
      setFileResults([]);
    }
  }

  function completeFileSelection() {
    const files = fileResults();
    const sel = fileSelected();
    const ap = atPos();
    if (ap === null || !files[sel]) return;

    const buf = deps.inputBuffer();
    const pos = deps.cursorPos();
    const before = buf.slice(0, ap);
    const after = buf.slice(pos);
    const completed = `${before}@${files[sel]} ${after}`;
    deps.setInputBuffer(completed);
    deps.setCursorPos(ap + 1 + files[sel].length + 1);

    batch(() => {
      setAtPos(null);
      setFileSelected(0);
      deps.setOverlay("none");
    });
  }

  return {
    showFileDropdown,
    atPos: () => atPos(),
    setAtPos,
    fileResults: () => fileResults(),
    fileSelected: () => fileSelected(),
    setFileSelected: setFileSelected as any,
    searchFiles,
    completeFileSelection,
    getAtQuery() {
      const ap = atPos();
      if (ap === null) return "";
      return deps.inputBuffer().slice(ap + 1, deps.cursorPos());
    },
  };
}