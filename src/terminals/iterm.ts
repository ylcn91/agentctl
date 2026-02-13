import type { TerminalProfile } from "./types.js";

export class ITermProfile implements TerminalProfile {
  id = "iterm";
  displayName = "iTerm2";
  platform = "darwin" as const;

  buildLaunchCommand(shellCmd: string): string[] {
    return ["open", "-a", "iTerm", "--", "zsh", "-c", shellCmd];
  }
}
