import { render, useTerminalDimensions, useRenderer } from "@opentui/solid";
import { Switch, Match, ErrorBoundary, onCleanup } from "solid-js";
import { ExitProvider } from "./context/exit.js";
import { KVProvider } from "./context/kv.js";
import { ToastProvider } from "./ui/toast.js";
import { RouteProvider, useRoute } from "./context/route.js";
import { ThemeProvider, useTheme } from "./context/theme.js";
import { NavProvider } from "./context/nav.js";
import { KeybindProvider } from "./context/keybind.js";
import { PromptStashProvider } from "./context/prompt-stash.js";
import { DialogProvider } from "./ui/dialog.js";
import { FrecencyProvider } from "./context/frecency.js";
import { PromptHistoryProvider } from "./context/prompt-history.js";
import { PromptRefProvider } from "./context/prompt-ref.js";
import { CommandPalette } from "./ui/command-palette.js";
import { HelpOverlay } from "./ui/help-overlay.js";
import { Sidebar } from "./ui/sidebar.js";
import { StatusBar } from "./ui/status-bar.js";
import { ChatView } from "./routes/chat/index.js";
import { Dashboard } from "./views/dashboard.js";
import { TaskBoard } from "./views/tasks.js";
import { WorkflowBoard } from "./views/workflows.js";
import { HealthDashboard } from "./views/health.js";
import { CouncilView } from "./views/council.js";
import { Launcher } from "./views/launcher.js";
import { MessageInbox } from "./views/inbox.js";
import { UsageDetail } from "./views/usage.js";
import { AddAccount } from "./views/add-account.js";
import { SLABoard } from "./views/sla.js";
import { PromptLibrary } from "./views/prompts.js";
import Analytics from "./views/analytics.js";
import { EntireSessions } from "./views/sessions.js";
import { AgentActivity } from "./views/activity.js";
import { VerificationView } from "./views/verification.js";
import { DelegationChain } from "./views/delegation.js";
import { TddView } from "./views/tdd.js";
import { WorkflowDetail } from "./views/workflow-detail.js";
import { ThemePicker } from "./views/theme-picker.js";
import { WorkflowWizard } from "./views/workflow-wizard.js";

function App() {
  const route = useRoute();
  const { colors } = useTheme();
  const dimensions = useTerminalDimensions();
  const renderer = useRenderer();
  renderer.disableStdoutInterception();

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={colors.background}
      flexDirection="column"
    >
      <HelpOverlay />
      <box flexGrow={1} flexDirection="row">
        <box flexGrow={1} flexDirection="column">
          <Switch>
            <Match when={route.data.type === "dashboard"}>
              <Dashboard />
            </Match>
            <Match when={route.data.type === "chat"}>
              <ChatView />
            </Match>
            <Match when={route.data.type === "tasks"}>
              <TaskBoard />
            </Match>
            <Match when={route.data.type === "inbox"}>
              <MessageInbox />
            </Match>
            <Match when={route.data.type === "launcher"}>
              <Launcher />
            </Match>
            <Match when={route.data.type === "usage"}>
              <UsageDetail />
            </Match>
            <Match when={route.data.type === "add"}>
              <AddAccount />
            </Match>
            <Match when={route.data.type === "sla"}>
              <SLABoard />
            </Match>
            <Match when={route.data.type === "prompts"}>
              <PromptLibrary />
            </Match>
            <Match when={route.data.type === "analytics"}>
              <Analytics />
            </Match>
            <Match when={route.data.type === "workflows"}>
              <WorkflowBoard />
            </Match>
            <Match when={route.data.type === "workflow_detail"}>
              <WorkflowDetail runId={(route.data as any).runId} />
            </Match>
            <Match when={route.data.type === "health"}>
              <HealthDashboard />
            </Match>
            <Match when={route.data.type === "council"}>
              <CouncilView />
            </Match>
            <Match when={route.data.type === "verify"}>
              <VerificationView />
            </Match>
            <Match when={route.data.type === "entire"}>
              <EntireSessions />
            </Match>
            <Match when={route.data.type === "chains"}>
              <DelegationChain />
            </Match>
            <Match when={route.data.type === "streams"}>
              <AgentActivity />
            </Match>
            <Match when={route.data.type === "tdd"}>
              <TddView />
            </Match>
            <Match when={route.data.type === "theme"}>
              <ThemePicker />
            </Match>
            <Match when={route.data.type === "wizard"}>
              <WorkflowWizard onClose={() => route.navigate({ type: "workflows" })} />
            </Match>
          </Switch>
        </box>
        <Sidebar />
      </box>
      <StatusBar />
      <CommandPalette />
    </box>
  );
}

function ErrorView(props: { error: Error; reset: () => void }) {
  onCleanup(() => {});
  const handler = (data: Buffer) => {
    if (data.length === 1 && data[0] === 0x03) {
      process.exit(1);
    }
  };
  process.stdin.on("data", handler);
  onCleanup(() => process.stdin.off("data", handler));

  return (
    <box flexDirection="column" padding={2}>
      <text fg="#f38ba8">A fatal error occurred: {props.error.message}</text>
      <text fg="#6c7086">{props.error.stack}</text>
      <text fg="#cdd6f4">Press Ctrl+C to exit</text>
    </box>
  );
}

export async function startTui(): Promise<void> {
  return new Promise<void>((resolve) => {
    const onExit = async () => { resolve(); };

    render(
      () => (
        <ErrorBoundary fallback={(error: any, reset: () => void) => <ErrorView error={error} reset={reset} />}>
          <ExitProvider onExit={onExit}>
            <KVProvider>
              <RouteProvider>
                <ThemeProvider>
                  <ToastProvider>
                    <NavProvider>
                      <KeybindProvider>
                        <PromptStashProvider>
                          <DialogProvider>
                            <FrecencyProvider>
                              <PromptHistoryProvider>
                                <PromptRefProvider>
                                  <App />
                                </PromptRefProvider>
                              </PromptHistoryProvider>
                            </FrecencyProvider>
                          </DialogProvider>
                        </PromptStashProvider>
                      </KeybindProvider>
                    </NavProvider>
                  </ToastProvider>
                </ThemeProvider>
              </RouteProvider>
            </KVProvider>
          </ExitProvider>
        </ErrorBoundary>
      ),
      {
        targetFps: 60,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
      },
    );
  });
}
