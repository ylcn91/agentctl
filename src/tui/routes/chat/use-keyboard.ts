
import { batch, type Accessor, type Setter } from "solid-js";
import type { Mode, Overlay, SlashCommand } from "./helpers.js";
import { SLASH_COMMANDS } from "./helpers.js";
import type { FileAutocomplete } from "./use-file-autocomplete.js";
import type { ShellController } from "./use-shell-mode.js";
import type { SlashCommandHandler } from "./use-slash-commands.js";
import type { Route } from "../../context/route.js";

export function createChatKeyboardHandler(deps: {
  mode: Accessor<Mode>;
  setMode: Setter<Mode>;
  overlay: Accessor<Overlay>;
  setOverlay: Setter<Overlay>;
  inputBuffer: Accessor<string>;
  setInputBuffer: Setter<string>;
  cursorPos: Accessor<number>;
  setCursorPos: Setter<number>;
  scrollOffset: Accessor<number>;
  setScrollOffset: Setter<number>;
  setAutoScroll: Setter<boolean>;
  slashSelected: Accessor<number>;
  setSlashSelected: Setter<number>;
  messages: Accessor<any[]>;
  streaming: Accessor<boolean>;
  showSlashDropdown: () => boolean;
  showFileDropdown: () => boolean;
  filteredSlash: Accessor<SlashCommand[]>;
  slashQuery: () => string;
  fileAutocomplete: FileAutocomplete;
  shellController: ShellController;
  slashCommands: SlashCommandHandler;
  send: (text: string) => Promise<void>;
  abort: () => void;
  clear: () => void;
  cycleAccount: () => void;
  navToggleCommandPalette: () => void;
  routeNavigate: (route: Route) => void;
}): (evt: any) => void {
  function shiftChar(evt: any): string {
    if (evt.shift && evt.name.length === 1 && /^[a-z]$/.test(evt.name)) return evt.name.toUpperCase();
    return evt.name;
  }

  function insertAtCursor(text: string) {
    const pos = deps.cursorPos();
    const buf = deps.inputBuffer();
    const next = buf.slice(0, pos) + text + buf.slice(pos);
    deps.setInputBuffer(next);
    deps.setCursorPos(pos + text.length);
    deps.shellController.checkShellMode(next);
  }

  return (evt: any) => {
    const ov = deps.overlay();
    if (ov === "accounts" || ov === "sessions" || ov === "models" || ov === "council" || ov === "retro") return;

    if (evt.ctrl && evt.name === "c") { if (deps.streaming()) { deps.abort(); evt.stopPropagation(); return; } }
    if (evt.ctrl && evt.name === "p") { deps.navToggleCommandPalette(); evt.stopPropagation(); return; }
    if (evt.ctrl && evt.name === "o") { deps.setOverlay("accounts"); evt.stopPropagation(); return; }

    if (deps.showFileDropdown()) {
      if (evt.name === "escape") {
        batch(() => { deps.fileAutocomplete.setAtPos(null); deps.fileAutocomplete.searchFiles(""); deps.fileAutocomplete.setFileSelected(0); deps.setOverlay("none"); });
        batch(() => { deps.fileAutocomplete.setAtPos(null); deps.setOverlay("none"); });
        evt.stopPropagation(); return;
      }
      if (evt.name === "return" || evt.name === "tab") {
        deps.fileAutocomplete.completeFileSelection();
        evt.stopPropagation(); return;
      }
      if (evt.name === "up") { deps.fileAutocomplete.setFileSelected((p: number) => Math.max(0, p - 1)); evt.stopPropagation(); return; }
      if (evt.name === "down") { deps.fileAutocomplete.setFileSelected((p: number) => Math.min(deps.fileAutocomplete.fileResults().length - 1, p + 1)); evt.stopPropagation(); return; }
      if (evt.name === "backspace") {
        const pos = deps.cursorPos();
        if (pos > 0) {
          const newBuf = deps.inputBuffer().slice(0, pos - 1) + deps.inputBuffer().slice(pos);
          deps.setInputBuffer(newBuf);
          deps.setCursorPos(pos - 1);
          const ap = deps.fileAutocomplete.atPos();
          if (ap !== null && pos - 1 <= ap) {
            batch(() => { deps.fileAutocomplete.setAtPos(null); deps.fileAutocomplete.setFileSelected(0); deps.setOverlay("none"); });
          } else {
            const q = newBuf.slice((ap ?? 0) + 1, pos - 1);
            deps.fileAutocomplete.searchFiles(q);
          }
        }
        evt.stopPropagation(); return;
      }
      if (evt.name === "space") {
        batch(() => { deps.fileAutocomplete.setAtPos(null); deps.fileAutocomplete.setFileSelected(0); deps.setOverlay("none"); });
        insertAtCursor(" ");
        evt.stopPropagation(); return;
      }
      if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta) {
        const pos = deps.cursorPos();
        const buf = deps.inputBuffer();
        const ch = shiftChar(evt);
        const next = buf.slice(0, pos) + ch + buf.slice(pos);
        deps.setInputBuffer(next);
        deps.setCursorPos(pos + 1);
        const q = next.slice((deps.fileAutocomplete.atPos() ?? 0) + 1, pos + 1);
        deps.fileAutocomplete.searchFiles(q);
        evt.stopPropagation(); return;
      }
      evt.stopPropagation();
      return;
    }

    if (deps.showSlashDropdown()) {
      if (evt.name === "escape") {
        batch(() => { deps.setOverlay("none"); deps.setInputBuffer(""); deps.setCursorPos(0); deps.setSlashSelected(0); deps.shellController.setShellMode(false); });
        evt.stopPropagation(); return;
      }
      if (evt.name === "return" && deps.filteredSlash()[deps.slashSelected()]) {
        deps.slashCommands.executeSlash(deps.filteredSlash()[deps.slashSelected()]);
        evt.stopPropagation(); return;
      }
      if (evt.name === "up") { deps.setSlashSelected((p) => Math.max(0, p - 1)); evt.stopPropagation(); return; }
      if (evt.name === "down") { deps.setSlashSelected((p) => Math.min(deps.filteredSlash().length - 1, p + 1)); evt.stopPropagation(); return; }
      if (evt.name === "backspace") {
        deps.setInputBuffer((prev) => {
          const n = prev.slice(0, -1);
          deps.setCursorPos(n.length);
          if (!n.startsWith("/")) { deps.setOverlay("none"); deps.setSlashSelected(0); }
          return n;
        });
        deps.setSlashSelected(0);
        evt.stopPropagation(); return;
      }
      if (evt.name === "space") {
        const exact = SLASH_COMMANDS.find((c) => c.id === deps.slashQuery());
        if (exact) { deps.slashCommands.executeSlash(exact); evt.stopPropagation(); return; }
        deps.setInputBuffer((p) => { deps.setCursorPos(p.length + 1); return p + " "; });
        deps.setSlashSelected(0);
      } else if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta) {
        const ch = shiftChar(evt);
        deps.setInputBuffer((p) => { deps.setCursorPos(p.length + 1); return p + ch; });
        deps.setSlashSelected(0);
      }
      evt.stopPropagation();
      return;
    }

    if (deps.mode() === "input") {
      if (evt.name === "escape") {
        if (deps.shellController.shellMode()) { deps.shellController.setShellMode(false); deps.setInputBuffer(""); deps.setCursorPos(0); }
        else { deps.setMode("browse"); }
        evt.stopPropagation(); return;
      }

      if ((evt.shift && evt.name === "return") || (evt.ctrl && evt.name === "j")) {
        insertAtCursor("\n");
        evt.stopPropagation(); return;
      }

      if (evt.name === "return") {
        const text = deps.inputBuffer().trim();
        if (!text) return;

        if (deps.shellController.shellMode()) {
          batch(() => { deps.setInputBuffer(""); deps.setCursorPos(0); deps.shellController.setShellMode(false); });
          deps.shellController.executeShellCommand(text);
          evt.stopPropagation(); return;
        }

        batch(() => { deps.setInputBuffer(""); deps.setCursorPos(0); });
        if (deps.slashCommands.handleTextCommand(text)) {
          evt.stopPropagation(); return;
        }

        deps.shellController.setShellMode(false);
        deps.send(text);
        evt.stopPropagation(); return;
      }

      if (evt.name === "tab") { deps.cycleAccount(); evt.stopPropagation(); return; }

      if (evt.name === "left") {
        deps.setCursorPos((p) => Math.max(0, p - 1));
        evt.stopPropagation(); return;
      }
      if (evt.name === "right") {
        deps.setCursorPos((p) => Math.min(deps.inputBuffer().length, p + 1));
        evt.stopPropagation(); return;
      }
      if (evt.name === "up" || evt.name === "down") {
        const buf = deps.inputBuffer();
        const ls = buf.split("\n");
        if (ls.length > 1) {
          let pos = 0;
          let curLine = 0;
          for (let i = 0; i < ls.length; i++) {
            if (pos + ls[i].length >= deps.cursorPos() || i === ls.length - 1) { curLine = i; break; }
            pos += ls[i].length + 1;
          }
          const col = deps.cursorPos() - pos;
          if (evt.name === "up" && curLine > 0) {
            let newPos = 0;
            for (let i = 0; i < curLine - 1; i++) newPos += ls[i].length + 1;
            deps.setCursorPos(newPos + Math.min(col, ls[curLine - 1].length));
          } else if (evt.name === "down" && curLine < ls.length - 1) {
            let newPos = 0;
            for (let i = 0; i <= curLine; i++) newPos += ls[i].length + 1;
            deps.setCursorPos(newPos + Math.min(col, ls[curLine + 1].length));
          }
          evt.stopPropagation(); return;
        }
      }

      if (evt.ctrl && evt.name === "a") {
        deps.setCursorPos(0); evt.stopPropagation(); return;
      }
      if (evt.ctrl && evt.name === "e") {
        deps.setCursorPos(deps.inputBuffer().length); evt.stopPropagation(); return;
      }
      if (evt.ctrl && evt.name === "u") {
        deps.setInputBuffer((buf) => buf.slice(deps.cursorPos()));
        deps.setCursorPos(0);
        deps.shellController.checkShellMode(deps.inputBuffer());
        evt.stopPropagation(); return;
      }
      if (evt.ctrl && evt.name === "k") {
        deps.setInputBuffer((buf) => buf.slice(0, deps.cursorPos()));
        evt.stopPropagation(); return;
      }
      if (evt.ctrl && evt.name === "w") {
        const buf = deps.inputBuffer();
        const pos = deps.cursorPos();
        const before = buf.slice(0, pos);
        const trimmed = before.trimEnd();
        const lastSpace = trimmed.lastIndexOf(" ");
        const newPos = lastSpace === -1 ? 0 : lastSpace + 1;
        deps.setInputBuffer(buf.slice(0, newPos) + buf.slice(pos));
        deps.setCursorPos(newPos);
        deps.shellController.checkShellMode(deps.inputBuffer());
        evt.stopPropagation(); return;
      }

      if (evt.name === "home") { deps.setCursorPos(0); evt.stopPropagation(); return; }
      if (evt.name === "end") { deps.setCursorPos(deps.inputBuffer().length); evt.stopPropagation(); return; }

      if (evt.name === "backspace") {
        const pos = deps.cursorPos();
        if (pos > 0) {
          const newBuf = deps.inputBuffer().slice(0, pos - 1) + deps.inputBuffer().slice(pos);
          deps.setInputBuffer(newBuf);
          deps.setCursorPos(pos - 1);
          deps.shellController.checkShellMode(newBuf);
        }
        evt.stopPropagation(); return;
      }
      if (evt.name === "delete") {
        const pos = deps.cursorPos();
        const newBuf = deps.inputBuffer().slice(0, pos) + deps.inputBuffer().slice(pos + 1);
        deps.setInputBuffer(newBuf);
        evt.stopPropagation(); return;
      }

      if (evt.name === "space") {
        insertAtCursor(" ");
        evt.stopPropagation(); return;
      }
      if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta) {
        const ch = shiftChar(evt);
        const pos = deps.cursorPos();
        const next = deps.inputBuffer().slice(0, pos) + ch + deps.inputBuffer().slice(pos);
        deps.setInputBuffer(next);
        deps.setCursorPos(pos + 1);
        deps.shellController.checkShellMode(next);

        if (next === "/") { deps.setOverlay("slash"); deps.setSlashSelected(0); }

        if (ch === "@") {
          deps.fileAutocomplete.setAtPos(pos);
          deps.setOverlay("files");
          deps.fileAutocomplete.setFileSelected(0);
          deps.fileAutocomplete.searchFiles("");
        }

        evt.stopPropagation();
      }
      return;
    }

    if (evt.name === "escape") { deps.routeNavigate({ type: "dashboard" }); evt.stopPropagation(); return; }
    if (evt.name === "return" || evt.name === "i") { deps.setMode("input"); evt.stopPropagation(); return; }
    if (evt.name === "tab") { deps.cycleAccount(); evt.stopPropagation(); return; }
    if (evt.name === "j" || evt.name === "down") { deps.setScrollOffset((o) => Math.max(0, o - 1)); deps.setAutoScroll(false); evt.stopPropagation(); }
    else if (evt.name === "k" || evt.name === "up") { deps.setScrollOffset((o) => o + 1); deps.setAutoScroll(false); evt.stopPropagation(); }
    else if (evt.name === "pagedown") { deps.setScrollOffset((o) => Math.max(0, o - 10)); deps.setAutoScroll(false); evt.stopPropagation(); }
    else if (evt.name === "pageup") { deps.setScrollOffset((o) => o + 10); deps.setAutoScroll(false); evt.stopPropagation(); }
    else if (evt.name === "f") { deps.setAutoScroll(true); deps.setScrollOffset(0); evt.stopPropagation(); }
    if (evt.name === "g" && !evt.ctrl && !evt.shift) { deps.setScrollOffset(deps.messages().length); deps.setAutoScroll(false); evt.stopPropagation(); }
    else if (evt.name === "G" || (evt.name === "g" && evt.shift)) { deps.setAutoScroll(true); deps.setScrollOffset(0); evt.stopPropagation(); }
    if (evt.ctrl && evt.name === "y") { deps.slashCommands.copyLastResponse(); evt.stopPropagation(); return; }
    if (evt.name === "c" && !evt.ctrl) deps.clear();
    if (evt.name === "o" && !evt.ctrl) deps.setOverlay("accounts");
    else if (evt.name === "s" && !evt.ctrl) deps.setOverlay("sessions");
    else if (evt.name === "/") {
      deps.setMode("input");
      deps.setInputBuffer("/");
      deps.setCursorPos(1);
      deps.setOverlay("slash");
      deps.setSlashSelected(0);
    }
  };
}
