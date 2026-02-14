import { test, expect, describe } from "bun:test";
import { getTheme, listThemes } from "../src/themes/index";
import { themes, DEFAULT_THEME_ID } from "../src/themes/definitions";
import type { InkTheme } from "../src/themes/types";

const EXPECTED_COLOR_KEYS: (keyof InkTheme["colors"])[] = [
  "text", "textMuted", "textStrong",
  "background", "backgroundPanel", "backgroundElement",
  "border", "borderActive", "borderSubtle",
  "primary", "primaryMuted",
  "success", "warning", "error", "info",
  "diffAdd", "diffRemove",
  "syntaxString", "syntaxKeyword", "syntaxComment",
];

describe("theme integration", () => {
  test("getTheme returns default theme for unknown ID", () => {
    const theme = getTheme("nonexistent-id-12345");
    expect(theme.id).toBe(DEFAULT_THEME_ID);
    expect(theme.name).toBe("Catppuccin Mocha");
  });

  test("getTheme returns default for empty string", () => {
    const theme = getTheme("");
    expect(theme.id).toBe(DEFAULT_THEME_ID);
  });

  test("getTheme returns specific theme by ID for every theme", () => {
    for (const [id, expected] of Object.entries(themes)) {
      const theme = getTheme(id);
      expect(theme.id).toBe(id);
      expect(theme.name).toBe(expected.name);
      expect(theme.colors).toEqual(expected.colors);
    }
  });

  test("listThemes returns all 15 themes with correct structure", () => {
    const list = listThemes();
    expect(list.length).toBe(15);
    for (const item of list) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.name).toBe("string");
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.name.length).toBeGreaterThan(0);
    }
  });

  test("listThemes IDs match themes record keys", () => {
    const list = listThemes();
    const listIds = new Set(list.map((t) => t.id));
    const recordIds = new Set(Object.keys(themes));
    expect(listIds).toEqual(recordIds);
  });

  test("all themes have exactly the same color keys (no missing keys)", () => {
    const referenceKeys = new Set(EXPECTED_COLOR_KEYS);
    for (const [id, theme] of Object.entries(themes)) {
      const themeKeys = new Set(Object.keys(theme.colors));
      // Every expected key must exist
      for (const key of referenceKeys) {
        expect(themeKeys.has(key)).toBe(true);
      }
      // No extra keys beyond what's expected
      expect(themeKeys.size).toBe(referenceKeys.size);
    }
  });

  test("default theme (catppuccin-mocha) has correct primary color", () => {
    const theme = getTheme("catppuccin-mocha");
    expect(theme.colors.primary).toBe("#89b4fa");
  });

  test("default theme ID is catppuccin-mocha", () => {
    expect(DEFAULT_THEME_ID).toBe("catppuccin-mocha");
  });

  test("all theme color values are valid hex colors", () => {
    const hexPattern = /^#[0-9a-f]{6}$/i;
    for (const [id, theme] of Object.entries(themes)) {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(value).toMatch(hexPattern);
      }
    }
  });

  test("no two themes share the same name", () => {
    const names = Object.values(themes).map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test("no two themes share the same primary color (except variants)", () => {
    // This checks that most themes have distinct primaries
    // Some theme families (tokyonight & tokyonight-storm) may share colors
    const primaries = new Map<string, string[]>();
    for (const theme of Object.values(themes)) {
      const existing = primaries.get(theme.colors.primary) ?? [];
      existing.push(theme.id);
      primaries.set(theme.colors.primary, existing);
    }
    // Each primary color is used by at most 2 themes (variants)
    for (const [color, ids] of primaries) {
      expect(ids.length).toBeLessThanOrEqual(2);
    }
  });

  test("every theme has matching id field and record key", () => {
    for (const [key, theme] of Object.entries(themes)) {
      expect(theme.id).toBe(key);
    }
  });

  test("known themes are present", () => {
    const expectedIds = [
      "catppuccin-mocha", "catppuccin-latte",
      "tokyonight", "tokyonight-storm",
      "dracula", "gruvbox-dark", "gruvbox-light",
      "nord", "one-dark",
      "solarized-dark", "solarized-light",
      "github-dark", "github-light",
      "rose-pine", "rose-pine-moon",
    ];
    for (const id of expectedIds) {
      expect(themes[id]).toBeDefined();
    }
  });
});
