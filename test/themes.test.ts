import { test, expect, describe } from "bun:test";
import { getTheme, listThemes } from "../src/themes/index.js";
import { themes, DEFAULT_THEME_ID } from "../src/themes/definitions.js";
import type { InkTheme } from "../src/themes/types.js";

const REQUIRED_COLOR_KEYS = [
  "text",
  "textMuted",
  "textStrong",
  "background",
  "backgroundPanel",
  "backgroundElement",
  "border",
  "borderActive",
  "borderSubtle",
  "primary",
  "primaryMuted",
  "success",
  "warning",
  "error",
  "info",
  "diffAdd",
  "diffRemove",
  "syntaxString",
  "syntaxKeyword",
  "syntaxComment",
] as const;

describe("themes", () => {
  test("getTheme returns default theme for valid id", () => {
    const theme = getTheme(DEFAULT_THEME_ID);
    expect(theme.id).toBe(DEFAULT_THEME_ID);
    expect(theme.name).toBeTruthy();
    expect(theme.colors).toBeDefined();
  });

  test("getTheme falls back to default for invalid id", () => {
    const theme = getTheme("nonexistent-theme-id");
    expect(theme.id).toBe(DEFAULT_THEME_ID);
  });

  test("getTheme falls back to default for undefined", () => {
    const theme = getTheme(undefined as any);
    expect(theme.id).toBe(DEFAULT_THEME_ID);
  });

  test("all themes have all required color keys", () => {
    for (const [id, theme] of Object.entries(themes)) {
      for (const key of REQUIRED_COLOR_KEYS) {
        expect(theme.colors[key]).toBeTruthy();
      }
      expect(theme.id).toBe(id);
      expect(theme.name).toBeTruthy();
    }
  });

  test("all theme color values are hex strings", () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/;
    for (const [id, theme] of Object.entries(themes)) {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(value).toMatch(hexPattern);
      }
    }
  });

  test("listThemes returns all themes with id and name", () => {
    const list = listThemes();
    expect(list.length).toBe(Object.keys(themes).length);
    expect(list.length).toBeGreaterThanOrEqual(15);
    for (const item of list) {
      expect(item.id).toBeTruthy();
      expect(item.name).toBeTruthy();
    }
  });

  test("listThemes includes known themes", () => {
    const list = listThemes();
    const ids = list.map((t) => t.id);
    expect(ids).toContain("catppuccin-mocha");
    expect(ids).toContain("dracula");
    expect(ids).toContain("nord");
    expect(ids).toContain("tokyonight");
    expect(ids).toContain("solarized-dark");
    expect(ids).toContain("github-dark");
    expect(ids).toContain("rose-pine");
  });

  test("each theme id matches its key in the themes record", () => {
    for (const [key, theme] of Object.entries(themes)) {
      expect(theme.id).toBe(key);
    }
  });

  test("default theme id exists in themes", () => {
    expect(themes[DEFAULT_THEME_ID]).toBeDefined();
  });
});
