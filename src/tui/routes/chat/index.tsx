
import { createSignal, createMemo, createEffect, on, onMount, onCleanup } from "solid-js";
import { Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "../../context/theme.js";
import { useNav } from "../../context/nav.js";
import { useRoute } from "../../context/route.js";
import { loadConfig } from "../../../config.js";
import type { AccountConfig } from "../../../types.js";

import type { Mode, Overlay } from "./helpers.js";
import { getModelsForProvider, SLASH_COMMANDS } from "./helpers.js";
import { MessageList } from "./message-list.js";
import { ModelPicker, SlashCommandDropdown, FileDropdown, InputArea } from "./input-bar.js";
import { ChatSidebar } from "./sidebar.js";
import { ChatSplash } from "./splash.js";
import { ChatFooter } from "./footer.js";
import { SessionPicker } from "./session-picker.js";
import { CouncilModal } from "./council-modal.js";
import { RetroModal } from "./retro-modal.js";
import { existsSync } from "fs";
import { getSockPath } from "../../../paths.js";

import { createSessionManager } from "./use-session.js";
import { createSendController } from "./use-send.js";
import { createShellController } from "./use-shell-mode.js";
import { createFileAutocomplete } from "./use-file-autocomplete.js";
import { createCouncilController } from "./use-council-state.js";
import { createSlashCommands } from "./use-slash-commands.js";
import { createChatKeyboardHandler } from "./use-keyboard.js";
import { useDialog } from "../../ui/dialog.js";

export function ChatView() {
  const { colors } = useTheme();
  const nav = useNav();
  const route = useRoute();

  const [accounts, setAccounts] = createSignal<AccountConfig[]>([]);
  const [accountIndex, setAccountIndex] = createSignal(0);
  const [mode, setMode] = createSignal<Mode>("input");
  const [inputBuffer, setInputBuffer] = createSignal("");
  const [autoScroll, setAutoScroll] = createSignal(true);
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [overlay, setOverlay] = createSignal<Overlay>("none");
  const [configLoaded, setConfigLoaded] = createSignal(false);
  const [slashSelected, setSlashSelected] = createSignal(0);
  const [cursorPos, setCursorPos] = createSignal(0);

  const [daemonConnected, setDaemonConnected] = createSignal(false);
  onMount(() => {
    function checkDaemon() { setDaemonConnected(existsSync(getSockPath())); }
    checkDaemon();
    const interval = setInterval(checkDaemon, 5_000);
    onCleanup(() => clearInterval(interval));
  });

  const session = createSessionManager(scrollOffset, autoScroll, setScrollOffset, setAutoScroll);
  const shellController = createShellController(session.setMessages);
  const { send } = createSendController(session);

  const fileAutocomplete = createFileAutocomplete({
    cursorPos,
    inputBuffer,
    overlay,
    setInputBuffer: (v: string) => setInputBuffer(v),
    setCursorPos: (v: number) => setCursorPos(v),
    setOverlay: (v: Overlay) => setOverlay(v),
  });

  const council = createCouncilController({
    session,
    accounts,
    daemonConnected,
  });

  const councilAwareSend = async (text: string) => {
    const decision = council.lastDecision();
    if (decision) {
      council.clearDecision();
      await send(`${text}\n\n---\nCouncil decision context:\n${decision}`);
    } else {
      await send(text);
    }
  };

  const slashCommands = createSlashCommands({
    session,
    accounts,
    daemonConnected,
    council,
    send,
    setInputBuffer,
    setCursorPos,
    setOverlay,
    setSlashSelected,
    newSession: () => session.newSession(),
    clear: () => session.clear(),
    routeNavigate: (r: any) => route.navigate(r),
    setShellMode: shellController.setShellMode,
    toggleHelp: () => nav.toggleHelp(),
  });

  const slashQuery = () => inputBuffer().startsWith("/") ? inputBuffer().slice(1) : "";
  const showSlashDropdown = () => overlay() === "slash" && inputBuffer().startsWith("/");
  const filteredSlash = createMemo(() => {
    const q = slashQuery().toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) => cmd.id.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
    );
  });

  const accountName = () => session.account()?.label || session.account()?.name || "Chat";
  const accountColor = () => session.account()?.color ?? colors.primary;
  const providerLabel = () => session.account()?.provider ?? "";
  const modelLabel = () => {
    const model = session.currentModel();
    if (!model) return "default";
    const provider = session.account()?.provider ?? "claude-code";
    const models = getModelsForProvider(provider);
    return models.find((m) => m.id === model)?.short ?? "custom";
  };
  const hasMessages = () => session.messages().length > 0 || session.streaming();
  const conversationTitle = createMemo(() => {
    const firstUser = session.messages().find((m) => m.role === "user");
    if (!firstUser) return "New Chat";
    return firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? "..." : "");
  });
  const isFullOverlay = () =>
    overlay() === "accounts" || overlay() === "sessions" || overlay() === "models"
    || overlay() === "council" || overlay() === "retro";

  function cycleAccount() {
    const accs = accounts();
    if (accs.length <= 1) return;
    const nextIdx = (accountIndex() + 1) % accs.length;
    setAccountIndex(nextIdx);
    session.switchAccount(accs[nextIdx]);
  }

  onMount(() => {
    nav.setGlobalNavEnabled(false);
    nav.setInputFocus("view");

    loadConfig()
      .then((config) => {
        if (config.accounts.length > 0) {
          setAccounts(config.accounts);
          session.switchAccount(config.accounts[0]);
        }
        setConfigLoaded(true);
      })
      .catch(() => setConfigLoaded(true));
  });

  onCleanup(() => {
    nav.setGlobalNavEnabled(true);
    nav.setInputFocus("global");
  });

  let prevMsgCount = 0;
  createEffect(on(() => session.messages().length, (count) => {
    if (count > prevMsgCount && prevMsgCount > 0) {
      setAutoScroll(true);
      setScrollOffset(0);
    }
    prevMsgCount = count;
  }));

  const handleKeyboard = createChatKeyboardHandler({
    mode, setMode,
    overlay, setOverlay,
    inputBuffer, setInputBuffer,
    cursorPos, setCursorPos,
    scrollOffset, setScrollOffset,
    setAutoScroll,
    slashSelected, setSlashSelected,
    messages: session.messages,
    streaming: session.streaming,
    showSlashDropdown,
    showFileDropdown: fileAutocomplete.showFileDropdown,
    filteredSlash,
    slashQuery,
    fileAutocomplete,
    shellController,
    slashCommands,
    send: councilAwareSend,
    abort: session.abort,
    clear: session.clear,
    cycleAccount,
    navToggleCommandPalette: () => nav.toggleCommandPalette(),
    routeNavigate: (r: any) => route.navigate(r),
  });
  const dialog = useDialog();
  useKeyboard((evt: any) => {
    if (dialog.active) return;
    handleKeyboard(evt);
  });

  const STREAMING_TIMEOUT_MS = 5 * 60 * 1000;
  let streamingTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(on(session.streaming, (isStreaming) => {
    if (streamingTimer) { clearTimeout(streamingTimer); streamingTimer = null; }
    if (isStreaming) {
      streamingTimer = setTimeout(() => {
        if (session.streaming()) session.abort();
      }, STREAMING_TIMEOUT_MS);
    }
  }));
  onCleanup(() => { if (streamingTimer) clearTimeout(streamingTimer); });

  return (
    <Show when={configLoaded()} fallback={<box><text fg={colors.textMuted}>Loading...</text></box>}>
      <box flexDirection="column" flexGrow={1}>
        <Show when={overlay() === "models"}>
          <ModelPicker
            currentModel={session.currentModel()}
            provider={session.account()?.provider ?? "claude-code"}
            onSelect={(id) => {
              session.setModelOverride(id);
              setOverlay("none");
            }}
            onClose={() => setOverlay("none")}
          />
        </Show>

        <Show when={overlay() === "sessions"}>
          <SessionPicker
            accountName={accountName()}
            session={session}
            onClose={() => setOverlay("none")}
          />
        </Show>

        <Show when={overlay() === "council"}>
          <CouncilModal
            accounts={accounts()}
            council={council}
            onClose={() => setOverlay("none")}
          />
        </Show>

        <Show when={overlay() === "retro"}>
          <RetroModal
            accounts={accounts()}
            council={council}
            onClose={() => setOverlay("none")}
          />
        </Show>

        <Show when={!isFullOverlay()}>
          <box flexDirection="row" flexGrow={1}>
            <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
              <Show when={hasMessages()} fallback={<ChatSplash />}>
                <MessageList
                  messages={session.messages()}
                  streamingChunks={session.streamingChunks()}
                  streaming={session.streaming()}
                  error={session.error()}
                  autoScroll={autoScroll()}
                  scrollOffset={scrollOffset()}
                  accountName={accountName()}
                  accountColor={accountColor()}
                  modelLabel={modelLabel()}
                  councilStates={council.councilStates}
                  councilVersion={council.councilVersion()}
                  retroStates={council.retroStates}
                  retroVersion={council.retroVersion()}
                />
              </Show>
              <box flexShrink={0} flexDirection="column">
                <Show when={showSlashDropdown()}>
                  <SlashCommandDropdown commands={filteredSlash()} selected={slashSelected()} />
                </Show>
                <Show when={fileAutocomplete.showFileDropdown()}>
                  <FileDropdown files={fileAutocomplete.fileResults()} selected={fileAutocomplete.fileSelected()} query={fileAutocomplete.getAtQuery()} />
                </Show>
                <InputArea
                  mode={mode()}
                  inputBuffer={inputBuffer()}
                  cursorPos={cursorPos()}
                  streaming={session.streaming()}
                  shellMode={shellController.shellMode()}
                  accountColor={accountColor()}
                  accountName={accountName()}
                  providerLabel={providerLabel()}
                  modelLabel={modelLabel()}
                  totalCost={session.totalCost()}
                />
                <ChatFooter
                  mode={mode()}
                  streaming={session.streaming()}
                  permissionPending={false}
                  accountName={accountName()}
                  accountColor={accountColor()}
                  providerLabel={providerLabel()}
                  modelLabel={modelLabel()}
                  totalCost={session.totalCost()}
                  planningMode={slashCommands.planningMode()}
                  delegating={slashCommands.delegating()}
                  shellMode={shellController.shellMode()}
                />
              </box>
            </box>
            <ChatSidebar
              messages={session.messages()}
              conversationTitle={conversationTitle()}
              messageCount={session.messages().length}
              totalCost={session.totalCost()}
              streaming={session.streaming()}
              streamingChunkCount={session.streamingChunks().length}
              accountName={accountName()}
              accountColor={accountColor()}
              providerLabel={providerLabel()}
              accounts={accounts()}
              accountIndex={accountIndex()}
            />
          </box>
        </Show>
      </box>
    </Show>
  );
}
