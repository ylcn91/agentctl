export interface TerminalProfile {
  id: string;
  displayName: string;
  platform: "darwin" | "linux" | "win32" | "all";
  buildLaunchCommand(shellCmd: string): string[];
}
