import { test, expect, describe } from "bun:test";
import { fuzzyMatch, COMMANDS } from "../src/tui/ui/command-palette";
import { NAV_KEYS } from "../src/tui/context/keybind";

describe("fuzzyMatch edge cases", () => {
  test("handles unicode characters in query", () => {
    const result = fuzzyMatch("cafe", "cafe\u0301");
    expect(result.matches).toBe(true);
  });

  test("handles unicode characters in text", () => {
    const result = fuzzyMatch("a", "\u00e4pple");
    expect(result.matches).toBe(false);
  });

  test("handles very long strings", () => {
    const longText = "a".repeat(10000) + "b";
    const result = fuzzyMatch("ab", longText);
    expect(result.matches).toBe(true);
    expect(result.indices[0]).toBe(0);
    expect(result.indices[1]).toBe(10000);
  });

  test("handles special regex characters in query", () => {
    const result = fuzzyMatch("(", "function (arg)");
    expect(result.matches).toBe(true);
  });

  test("handles brackets and dots", () => {
    const result = fuzzyMatch("[0]", "array[0].value");
    expect(result.matches).toBe(true);
    expect(result.indices).toEqual([5, 6, 7]);
  });

  test("handles asterisks and plus signs", () => {
    const result = fuzzyMatch("*+", "a*b+c");
    expect(result.matches).toBe(true);
  });

  test("single character query", () => {
    const result = fuzzyMatch("d", "Dashboard");
    expect(result.matches).toBe(true);
    expect(result.indices).toEqual([0]);
  });

  test("query with spaces", () => {
    const result = fuzzyMatch("l a", "Launch Account");
    expect(result.matches).toBe(true);
  });

  test("no match when characters are in wrong order", () => {
    const result = fuzzyMatch("ba", "ab");
    expect(result.matches).toBe(false);
  });

  test("repeated characters match greedily left-to-right", () => {
    const result = fuzzyMatch("aa", "abac");
    expect(result.matches).toBe(true);
    expect(result.indices).toEqual([0, 2]);
  });
});

describe("COMMANDS list integrity", () => {
  test("has no duplicate IDs", () => {
    const ids = COMMANDS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("has no duplicate actions", () => {
    const actions = COMMANDS.map((c) => c.action);
    const unique = new Set(actions);
    expect(unique.size).toBe(actions.length);
  });

  test("has no duplicate labels", () => {
    const labels = COMMANDS.map((c) => c.label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });

  test("every command has non-empty id, label, and action", () => {
    for (const cmd of COMMANDS) {
      expect(cmd.id.length).toBeGreaterThan(0);
      expect(cmd.label.length).toBeGreaterThan(0);
      expect(cmd.action.length).toBeGreaterThan(0);
    }
  });
});

describe("NAV_KEYS and COMMANDS alignment", () => {
  test("every NAV_KEYS view has a matching command action", () => {
    const commandActions = new Set(COMMANDS.map((c) => c.action));
    for (const [key, view] of Object.entries(NAV_KEYS)) {
      expect(commandActions.has(view)).toBe(true);
    }
  });

  test("every NAV_KEYS shortcut matches the corresponding command shortcut", () => {
    const commandsByAction = new Map(COMMANDS.map((c) => [c.action, c]));
    for (const [key, view] of Object.entries(NAV_KEYS)) {
      const cmd = commandsByAction.get(view);
      expect(cmd).toBeDefined();
      if (cmd?.shortcut) {
        expect(cmd.shortcut).toBe(key);
      }
    }
  });
});

describe("fuzzy matching ranking", () => {
  test("exact prefix match scores higher (earlier indices) than scattered match", () => {
    const prefixResult = fuzzyMatch("da", "Dashboard");
    const scatteredResult = fuzzyMatch("da", "Add Account");

    expect(prefixResult.matches).toBe(true);
    expect(scatteredResult.matches).toBe(true);

    expect(prefixResult.indices[0]).toBe(0);
    expect(prefixResult.indices[1]).toBe(1);

    expect(scatteredResult.indices[0]).toBeGreaterThan(0);
  });

  test("filtering with COMMANDS produces subset", () => {
    const query = "dash";
    const filtered = COMMANDS.filter((cmd) => fuzzyMatch(query, cmd.label).matches);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(COMMANDS.length);
    expect(filtered.some((c) => c.id === "dashboard")).toBe(true);
  });

  test("empty query matches all commands", () => {
    const filtered = COMMANDS.filter((cmd) => fuzzyMatch("", cmd.label).matches);
    expect(filtered.length).toBe(COMMANDS.length);
  });

  test("nonsense query matches no commands", () => {
    const filtered = COMMANDS.filter((cmd) => fuzzyMatch("zzzzxxx", cmd.label).matches);
    expect(filtered.length).toBe(0);
  });
});
