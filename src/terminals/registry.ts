import type { TerminalProfile } from "./types.js";
import { WezTermProfile } from "./wezterm.js";
import { ITermProfile } from "./iterm.js";
import { GnomeTerminalProfile } from "./gnome.js";
import { WindowsTerminalProfile } from "./windows-terminal.js";

export class TerminalRegistry {
  private terminals = new Map<string, TerminalProfile>();

  register(profile: TerminalProfile): void {
    this.terminals.set(profile.id, profile);
  }

  get(id: string): TerminalProfile | undefined {
    return this.terminals.get(id);
  }

  listAll(): TerminalProfile[] {
    return Array.from(this.terminals.values());
  }

  listForPlatform(platform?: string): TerminalProfile[] {
    const p = platform ?? process.platform;
    return this.listAll().filter((t) => t.platform === p || t.platform === "all");
  }

  async detectDefault(): Promise<TerminalProfile | undefined> {
    const candidates = this.listForPlatform();
    for (const terminal of candidates) {
      try {
        if (process.platform === "darwin") {
          await Bun.$`mdfind "kMDItemCFBundleIdentifier == '*'" | grep -qi ${terminal.id}`.quiet();
          return terminal;
        }
        await Bun.$`which ${terminal.id}`.quiet();
        return terminal;
      } catch {
        continue;
      }
    }
    return candidates[0];
  }
}

export function createDefaultTerminalRegistry(): TerminalRegistry {
  const registry = new TerminalRegistry();
  registry.register(new WezTermProfile());
  registry.register(new ITermProfile());
  registry.register(new GnomeTerminalProfile());
  registry.register(new WindowsTerminalProfile());
  return registry;
}

export const terminalRegistry = createDefaultTerminalRegistry();
