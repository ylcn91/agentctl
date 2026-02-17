
import { createSignal, type Setter } from "solid-js";
import type { ChatMessage } from "../../../services/chat-session.js";

export interface ShellController {
  shellMode: () => boolean;
  setShellMode: Setter<boolean>;
  checkShellMode: (buf: string) => void;
  executeShellCommand: (cmd: string) => Promise<void>;
}

export function createShellController(
  setMessages: Setter<ChatMessage[]>,
): ShellController {
  const [shellMode, setShellMode] = createSignal(false);

  function checkShellMode(buf: string) {
    setShellMode(buf.startsWith("!"));
  }

  async function executeShellCommand(cmd: string) {
    const shellCmd = cmd.slice(1).trim();
    if (!shellCmd) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: `$ ${shellCmd}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const proc = Bun.spawn(["sh", "-c", shellCmd], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).trim();
      const resultMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: output || `(exit code: ${exitCode})`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, resultMsg]);
    } catch (err) {
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `[shell error] ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    }
  }

  return { shellMode, setShellMode, checkShellMode, executeShellCommand };
}
