import type { TerminalProfile } from "./types.js";

export class WezTermProfile implements TerminalProfile {
  id = "wezterm";
  displayName = "WezTerm";
  platform = "darwin" as const;

  buildLaunchCommand(shellCmd: string): string[] {
    return ["open", "-a", "WezTerm", "--", "zsh", "-c", shellCmd];
  }
}
