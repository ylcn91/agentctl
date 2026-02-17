
import { createSignal, onMount, For, Show, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../context/theme.js";
import { listSessions, deleteSession, type StoredSession } from "../../../services/chat-store.js";
import type { SessionManager } from "./use-session.js";

interface SessionPickerProps {
  accountName: string;
  session: SessionManager;
  onClose: () => void;
}

export function SessionPicker(props: SessionPickerProps) {
  const { colors } = useTheme();
  const [sessions, setSessions] = createSignal<StoredSession[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [search, setSearch] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [renameBuffer, setRenameBuffer] = createSignal("");

  const filtered = createMemo(() => {
    const q = search().toLowerCase();
    if (!q) return sessions();
    return sessions().filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.accountName.toLowerCase().includes(q),
    );
  });

  async function refresh() {
    setLoading(true);
    const all = await listSessions({ limit: 50 });
    setSessions(all);
    setLoading(false);
  }

  onMount(() => { refresh(); });

  function formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffH = Math.floor(diffMs / 3_600_000);
      if (diffH < 1) return "just now";
      if (diffH < 24) return `${diffH}h ago`;
      const diffD = Math.floor(diffH / 24);
      if (diffD < 7) return `${diffD}d ago`;
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return iso.slice(0, 10); }
  }

  useKeyboard((evt: any) => {

    if (renaming()) {
      if (evt.name === "escape") {
        setRenaming(null);
        setRenameBuffer("");
        evt.stopPropagation(); return;
      }
      if (evt.name === "return") {
        const id = renaming()!;
        const newTitle = renameBuffer().trim();
        if (newTitle) {
          const sess = sessions().find((s) => s.id === id);
          if (sess) {

            sess.title = newTitle;
            setSessions([...sessions()]);
          }
        }
        setRenaming(null);
        setRenameBuffer("");
        evt.stopPropagation(); return;
      }
      if (evt.name === "backspace") {
        setRenameBuffer((b) => b.slice(0, -1));
        evt.stopPropagation(); return;
      }
      if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta) {
        setRenameBuffer((b) => b + evt.name);
        evt.stopPropagation(); return;
      }
      if (evt.name === "space") {
        setRenameBuffer((b) => b + " ");
        evt.stopPropagation(); return;
      }
      evt.stopPropagation(); return;
    }

    if (evt.name === "escape") { props.onClose(); evt.stopPropagation(); return; }
    if (evt.name === "up" || evt.name === "k") {
      setSelected((p) => Math.max(0, p - 1));
      evt.stopPropagation(); return;
    }
    if (evt.name === "down" || evt.name === "j") {
      setSelected((p) => Math.min(filtered().length - 1, p + 1));
      evt.stopPropagation(); return;
    }

    if (evt.name === "return") {
      const sess = filtered()[selected()];
      if (sess) {
        props.session.loadSessionById(sess.id);
        props.onClose();
      }
      evt.stopPropagation(); return;
    }

    if (evt.name === "n") {
      props.session.newSession();
      props.onClose();
      evt.stopPropagation(); return;
    }

    if (evt.name === "d") {
      const sess = filtered()[selected()];
      if (sess) {
        deleteSession(sess.id).then(() => refresh());
        setSelected((p) => Math.max(0, p - 1));
      }
      evt.stopPropagation(); return;
    }

    if (evt.name === "r") {
      const sess = filtered()[selected()];
      if (sess) {
        setRenaming(sess.id);
        setRenameBuffer(sess.title);
      }
      evt.stopPropagation(); return;
    }

    if (evt.name === "backspace") {
      setSearch((p) => p.slice(0, -1));
      setSelected(0);
      evt.stopPropagation(); return;
    }
    if (evt.name === "space") {
      setSearch((p) => p + " ");
      setSelected(0);
      evt.stopPropagation(); return;
    }
    if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta) {
      setSearch((p) => p + evt.name);
      setSelected(0);
      evt.stopPropagation();
    }
  });

  return (
    <box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
      <box flexDirection="row" marginBottom={1}>
        <text fg={colors.primary} attributes={TextAttributes.BOLD}>Sessions</text>
        <text fg={colors.textMuted}>{`  ${filtered().length} sessions`}</text>
      </box>

      <Show when={search().length > 0}>
        <box flexDirection="row" marginBottom={1}>
          <text fg={colors.primary}>{"> "}</text>
          <text fg={colors.text}>{search()}</text>
          <text fg={colors.textMuted}>|</text>
        </box>
      </Show>

      <Show when={loading()}>
        <text fg={colors.textMuted}>Loading sessions...</text>
      </Show>

      <Show when={!loading() && filtered().length === 0}>
        <text fg={colors.textMuted}>
          {sessions().length === 0 ? "No sessions yet. Start chatting!" : "No matching sessions."}
        </text>
      </Show>

      <Show when={!loading()}>
        <box flexDirection="column">
          <For each={filtered().slice(0, 15)}>
            {(sess, idx) => {
              const isSel = () => idx() === selected();
              const isRenaming = () => renaming() === sess.id;
              const msgCount = sess.messages.length;
              const cost = sess.totalCost;

              return (
                <box flexDirection="row" marginLeft={1}>
                  <text fg={isSel() ? colors.primary : colors.textMuted}>
                    {isSel() ? "> " : "  "}
                  </text>
                  <Show when={isRenaming()} fallback={
                    <box flexDirection="row" flexGrow={1}>
                      <text
                        fg={isSel() ? colors.text : colors.textMuted}
                        attributes={isSel() ? TextAttributes.BOLD : undefined}
                      >
                        {sess.title.slice(0, 38).padEnd(40)}
                      </text>
                      <text fg={colors.textMuted}>{formatDate(sess.updatedAt).padEnd(10)}</text>
                      <text fg={colors.textMuted}>{`${msgCount}msg`.padEnd(8)}</text>
                      <Show when={cost != null && cost > 0}>
                        <text fg={colors.textMuted}>{`$${cost!.toFixed(2)}`}</text>
                      </Show>
                    </box>
                  }>
                    <box flexDirection="row">
                      <text fg={colors.warning}>rename: </text>
                      <text fg={colors.text}>{renameBuffer()}</text>
                      <text fg={colors.primary}>|</text>
                    </box>
                  </Show>
                </box>
              );
            }}
          </For>
          <Show when={filtered().length > 15}>
            <text fg={colors.textMuted}>{`  ...and ${filtered().length - 15} more`}</text>
          </Show>
        </box>
      </Show>

      <box marginTop={1}>
        <text fg={colors.textMuted}>
          j/k navigate  Enter load  n new  r rename  d delete  type to search  Esc close
        </text>
      </box>
    </box>
  );
}
