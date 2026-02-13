import type { TerminalProfile } from "./types.js";

export class GnomeTerminalProfile implements TerminalProfile {
  id = "gnome-terminal";
  displayName = "GNOME Terminal";
  platform = "linux" as const;

  buildLaunchCommand(shellCmd: string): string[] {
    return ["gnome-terminal", "--", "bash", "-c", shellCmd];
  }
}
