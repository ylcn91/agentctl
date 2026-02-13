import type { TerminalProfile } from "./types.js";

export class WindowsTerminalProfile implements TerminalProfile {
  id = "windows-terminal";
  displayName = "Windows Terminal";
  platform = "win32" as const;

  buildLaunchCommand(shellCmd: string): string[] {
    return ["wt", "new-tab", "cmd", "/c", shellCmd];
  }
}
