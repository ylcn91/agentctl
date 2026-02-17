
import { stripControlChars } from "./input-sanitizer.js";

export const MAX_SHELL_COMMAND_LENGTH = 2_000;

export const DANGEROUS_SHELL_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /`[^`]*`/, description: "backtick command substitution" },
  { pattern: /\$\(/, description: "$() command substitution" },
  { pattern: /\$\{/, description: "${} variable expansion" },
  { pattern: /;/, description: "command chaining with semicolon" },
  { pattern: /\|/, description: "pipe operator" },
  { pattern: /&&/, description: "AND chaining (&&)" },
  { pattern: /\|\|/, description: "OR chaining (||)" },
  { pattern: />\s*>?/, description: "output redirection" },
  { pattern: /</, description: "input redirection" },
  { pattern: /\x00/, description: "null byte" },
];

export function sanitizeShellCommand(command: string): { safe: boolean; command: string; reason?: string } {
  if (!command || command.trim().length === 0) {
    return { safe: false, command, reason: "Empty command" };
  }

  if (command.length > MAX_SHELL_COMMAND_LENGTH) {
    return { safe: false, command, reason: `Command exceeds maximum length of ${MAX_SHELL_COMMAND_LENGTH} characters (got ${command.length})` };
  }

  for (const { pattern, description } of DANGEROUS_SHELL_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, command, reason: `Dangerous shell pattern detected: ${description}` };
    }
  }

  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command)) {
    return { safe: false, command, reason: "Command contains control characters" };
  }

  return { safe: true, command: command.trim() };
}

export function sanitizeFTS5Query(query: string): string {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .map(term => term.replace(/"/g, '""'))
    .filter(term => {

      const stripped = term.replace(/""/g, "");
      return stripped.length > 0;
    })
    .map(term => `"${term}"`);
  return terms.join(" ");
}

export function sanitizeStringFields(payload: Record<string, unknown>): Record<string, unknown> {
  if (typeof payload.goal === "string") {
    payload.goal = stripControlChars(payload.goal);
  }

  if (Array.isArray(payload.acceptance_criteria)) {
    payload.acceptance_criteria = payload.acceptance_criteria.map(
      (item: unknown) => (typeof item === "string" ? stripControlChars(item) : item)
    );
  }

  if (Array.isArray(payload.run_commands)) {
    payload.run_commands = payload.run_commands.map(
      (cmd: unknown) => (typeof cmd === "string" ? stripControlChars(cmd) : cmd)
    );
  }

  if (Array.isArray(payload.blocked_by)) {
    payload.blocked_by = payload.blocked_by.map(
      (b: unknown) => (typeof b === "string" ? stripControlChars(b) : b)
    );
  }

  if (typeof payload.parent_handoff_id === "string") {
    payload.parent_handoff_id = stripControlChars(payload.parent_handoff_id);
  }

  return payload;
}
