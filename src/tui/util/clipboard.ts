
import { platform } from "os";

function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return;
  const base64 = Buffer.from(text).toString("base64");
  const osc52 = `\x1b]52;c;${base64}\x07`;
  const passthrough = process.env["TMUX"] || process.env["STY"];
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
  process.stdout.write(sequence);
}

let _copyMethod: ((text: string) => Promise<void>) | null = null;

function getCopyMethod(): (text: string) => Promise<void> {
  if (_copyMethod) return _copyMethod;

  const os = platform();

  if (os === "darwin" && Bun.which("osascript")) {
    _copyMethod = async (text: string) => {
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const proc = Bun.spawn(["osascript", "-e", `set the clipboard to "${escaped}"`], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    };
    return _copyMethod;
  }

  if (os === "linux") {
    if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
      _copyMethod = async (text: string) => {
        const proc = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
      return _copyMethod;
    }
    if (Bun.which("xclip")) {
      _copyMethod = async (text: string) => {
        const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
          stdin: "pipe", stdout: "ignore", stderr: "ignore",
        });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
      return _copyMethod;
    }
    if (Bun.which("xsel")) {
      _copyMethod = async (text: string) => {
        const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
          stdin: "pipe", stdout: "ignore", stderr: "ignore",
        });
        proc.stdin.write(text);
        proc.stdin.end();
        await proc.exited.catch(() => {});
      };
      return _copyMethod;
    }
  }

  if (os === "win32") {
    _copyMethod = async (text: string) => {
      const proc = Bun.spawn(
        ["powershell.exe", "-NonInteractive", "-NoProfile", "-Command",
         "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
        { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
      );
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited.catch(() => {});
    };
    return _copyMethod;
  }

  _copyMethod = async () => {};
  return _copyMethod;
}

export async function copyToClipboard(text: string): Promise<void> {
  writeOsc52(text);
  await getCopyMethod()(text);
}
