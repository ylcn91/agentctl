import { describe, test, expect } from "bun:test";
import { ClaudeCodeProvider } from "../src/providers/claude-code";
import type { Account } from "../src/providers/types";

describe("Launcher", () => {
  const provider = new ClaudeCodeProvider();

  describe("buildLaunchCommand", () => {
    test("builds basic launch command", () => {
      const account: Account = {
        name: "claude",
        configDir: "/home/user/.claude",
        provider: "claude-code",
      };
      const cmd = provider.buildLaunchCommand(account, {});
      expect(cmd[0]).toBe("CLAUDE_CONFIG_DIR=/home/user/.claude");
      expect(cmd[1]).toBe("claude");
      expect(cmd).toHaveLength(2);
    });

    test("includes --resume flag", () => {
      const account: Account = {
        name: "claude",
        configDir: "/home/user/.claude",
        provider: "claude-code",
      };
      const cmd = provider.buildLaunchCommand(account, { resume: true });
      expect(cmd).toContain("--resume");
    });

    test("includes --dir flag with directory", () => {
      const account: Account = {
        name: "claude",
        configDir: "/home/user/.claude",
        provider: "claude-code",
      };
      const cmd = provider.buildLaunchCommand(account, { dir: "/projects/app" });
      expect(cmd).toContain("--dir");
      expect(cmd).toContain("/projects/app");
    });

    test("includes both --resume and --dir", () => {
      const account: Account = {
        name: "claude-admin",
        configDir: "/home/user/.claude-admin",
        provider: "claude-code",
      };
      const cmd = provider.buildLaunchCommand(account, {
        dir: "/projects/app",
        resume: true,
      });
      expect(cmd[0]).toBe("CLAUDE_CONFIG_DIR=/home/user/.claude-admin");
      expect(cmd).toContain("claude");
      expect(cmd).toContain("--resume");
      expect(cmd).toContain("--dir");
      expect(cmd).toContain("/projects/app");
    });
  });

  describe("shell command assembly", () => {
    test("assembles env + command for shell execution", () => {
      const account: Account = {
        name: "claude-work",
        configDir: "~/.claude-work",
        provider: "claude-code",
      };
      const cmd = provider.buildLaunchCommand(account, { dir: "/projects/app" });
      const envPart = cmd[0];
      const args = cmd.slice(1);
      const shellCmd = `${envPart} ${args.join(" ")}`;
      expect(shellCmd).toBe(
        "CLAUDE_CONFIG_DIR=~/.claude-work claude --dir /projects/app"
      );
    });
  });

  describe("option toggling logic", () => {
    test("toggles boolean options correctly", () => {
      const options = { resume: false, newWindow: true, autoEntire: true };
      const keys = ["resume", "newWindow", "autoEntire"] as const;

      // Toggle resume on
      const toggled = { ...options, [keys[0]]: !options[keys[0]] };
      expect(toggled.resume).toBe(true);
      expect(toggled.newWindow).toBe(true);

      // Toggle newWindow off
      const toggled2 = { ...toggled, [keys[1]]: !toggled[keys[1]] };
      expect(toggled2.newWindow).toBe(false);
    });
  });

  describe("configDir tilde expansion", () => {
    test("expands ~ to HOME", () => {
      const configDir = "~/.claude-admin";
      const expanded = configDir.replace("~", "/home/user");
      expect(expanded).toBe("/home/user/.claude-admin");
    });

    test("does not expand if no tilde", () => {
      const configDir = "/absolute/path/.claude";
      const expanded = configDir.replace("~", "/home/user");
      expect(expanded).toBe("/absolute/path/.claude");
    });
  });
});
