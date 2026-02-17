import { SyntaxStyle, RGBA, type TerminalColors } from "@opentui/core";
import { createMemo, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createSimpleContext } from "./helper.js";
import { useKV } from "./kv.js";
import { useRenderer } from "@opentui/solid";

import aura from "../themes/aura.json" with { type: "json" };
import ayu from "../themes/ayu.json" with { type: "json" };
import catppuccin from "../themes/catppuccin.json" with { type: "json" };
import catppuccinFrappe from "../themes/catppuccin-frappe.json" with { type: "json" };
import catppuccinMacchiato from "../themes/catppuccin-macchiato.json" with { type: "json" };
import cobalt2 from "../themes/cobalt2.json" with { type: "json" };
import cursor from "../themes/cursor.json" with { type: "json" };
import dracula from "../themes/dracula.json" with { type: "json" };
import everforest from "../themes/everforest.json" with { type: "json" };
import flexoki from "../themes/flexoki.json" with { type: "json" };
import github from "../themes/github.json" with { type: "json" };
import gruvbox from "../themes/gruvbox.json" with { type: "json" };
import kanagawa from "../themes/kanagawa.json" with { type: "json" };
import material from "../themes/material.json" with { type: "json" };
import matrix from "../themes/matrix.json" with { type: "json" };
import mercury from "../themes/mercury.json" with { type: "json" };
import monokai from "../themes/monokai.json" with { type: "json" };
import nightowl from "../themes/nightowl.json" with { type: "json" };
import nord from "../themes/nord.json" with { type: "json" };
import onedark from "../themes/one-dark.json" with { type: "json" };
import opencode from "../themes/opencode.json" with { type: "json" };
import orng from "../themes/orng.json" with { type: "json" };
import lucentOrng from "../themes/lucent-orng.json" with { type: "json" };
import osakaJade from "../themes/osaka-jade.json" with { type: "json" };
import palenight from "../themes/palenight.json" with { type: "json" };
import rosepine from "../themes/rosepine.json" with { type: "json" };
import rosepineMoon from "../themes/rose-pine-moon.json" with { type: "json" };
import solarized from "../themes/solarized.json" with { type: "json" };
import synthwave84 from "../themes/synthwave84.json" with { type: "json" };
import tokyonight from "../themes/tokyonight.json" with { type: "json" };
import tokyonightStorm from "../themes/tokyonight-storm.json" with { type: "json" };
import vercel from "../themes/vercel.json" with { type: "json" };
import vesper from "../themes/vesper.json" with { type: "json" };
import zenburn from "../themes/zenburn.json" with { type: "json" };
import carbonfox from "../themes/carbonfox.json" with { type: "json" };

export type ThemeColors = {
  primary: RGBA;
  secondary: RGBA;
  accent: RGBA;
  error: RGBA;
  warning: RGBA;
  success: RGBA;
  info: RGBA;
  text: RGBA;
  textMuted: RGBA;
  selectedListItemText: RGBA;
  background: RGBA;
  backgroundPanel: RGBA;
  backgroundElement: RGBA;
  backgroundMenu: RGBA;
  border: RGBA;
  borderActive: RGBA;
  borderSubtle: RGBA;
  diffAdded: RGBA;
  diffRemoved: RGBA;
  diffContext: RGBA;
  diffHunkHeader: RGBA;
  diffHighlightAdded: RGBA;
  diffHighlightRemoved: RGBA;
  diffAddedBg: RGBA;
  diffRemovedBg: RGBA;
  diffContextBg: RGBA;
  diffLineNumber: RGBA;
  diffAddedLineNumberBg: RGBA;
  diffRemovedLineNumberBg: RGBA;
  markdownText: RGBA;
  markdownHeading: RGBA;
  markdownLink: RGBA;
  markdownLinkText: RGBA;
  markdownCode: RGBA;
  markdownBlockQuote: RGBA;
  markdownEmph: RGBA;
  markdownStrong: RGBA;
  markdownHorizontalRule: RGBA;
  markdownListItem: RGBA;
  markdownListEnumeration: RGBA;
  markdownImage: RGBA;
  markdownImageText: RGBA;
  markdownCodeBlock: RGBA;
  syntaxComment: RGBA;
  syntaxKeyword: RGBA;
  syntaxFunction: RGBA;
  syntaxVariable: RGBA;
  syntaxString: RGBA;
  syntaxNumber: RGBA;
  syntaxType: RGBA;
  syntaxOperator: RGBA;
  syntaxPunctuation: RGBA;
};

type Theme = ThemeColors & {
  _hasSelectedListItemText: boolean;
  thinkingOpacity: number;
};

type HexColor = `#${string}`;
type RefName = string;
type Variant = { dark: HexColor | RefName; light: HexColor | RefName };
type ColorValue = HexColor | RefName | Variant | RGBA;

type ThemeJson = {
  $schema?: string;
  defs?: Record<string, HexColor | RefName>;
  theme: Omit<Record<keyof ThemeColors, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue;
    backgroundMenu?: ColorValue;
    thinkingOpacity?: number;
  };
};

const DEFAULT_THEMES: Record<string, ThemeJson> = {
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  opencode,
  orng,
  ["lucent-orng"]: lucentOrng,
  ["osaka-jade"]: osakaJade,
  palenight,
  rosepine,
  ["rose-pine-moon"]: rosepineMoon,
  solarized,
  synthwave84,
  tokyonight,
  ["tokyonight-storm"]: tokyonightStorm,
  vercel,
  vesper,
  zenburn,
  carbonfox,
};

const DEFAULT_THEME = "catppuccin";

function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    const ansiColors = [
      "#000000", "#800000", "#008000", "#808000",
      "#000080", "#800080", "#008080", "#c0c0c0",
      "#808080", "#ff0000", "#00ff00", "#ffff00",
      "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ];
    return RGBA.fromHex(ansiColors[code] ?? "#000000");
  }
  if (code < 232) {
    const index = code - 16;
    const b = index % 6;
    const g = Math.floor(index / 6) % 6;
    const r = Math.floor(index / 36);
    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55);
    return RGBA.fromInts(val(r), val(g), val(b));
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8;
    return RGBA.fromInts(gray, gray, gray);
  }
  return RGBA.fromInts(0, 0, 0);
}

function resolveTheme(theme: ThemeJson, mode: "dark" | "light"): Theme {
  const defs = theme.defs ?? {};

  function resolveColor(c: ColorValue): RGBA {
    if (c instanceof RGBA) return c;
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0);
      if (c.startsWith("#")) return RGBA.fromHex(c);
      if (defs[c] != null) return resolveColor(defs[c]);
      if (theme.theme[c as keyof ThemeColors] !== undefined) {
        return resolveColor(theme.theme[c as keyof ThemeColors]!);
      }
      throw new Error(`Color reference "${c}" not found in defs or theme`);
    }
    if (typeof c === "number") return ansiToRgba(c);
    return resolveColor(c[mode]);
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => [key, resolveColor(value as ColorValue)]),
  ) as Partial<ThemeColors>;

  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined;
  if (hasSelectedListItemText) {
    resolved.selectedListItemText = resolveColor(theme.theme.selectedListItemText!);
  } else {
    resolved.selectedListItemText = resolved.background;
  }

  if (theme.theme.backgroundMenu !== undefined) {
    resolved.backgroundMenu = resolveColor(theme.theme.backgroundMenu);
  } else {
    resolved.backgroundMenu = resolved.backgroundElement;
  }

  const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6;

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity,
  } as Theme;
}

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  if (theme._hasSelectedListItemText) return theme.selectedListItemText;
  if (theme.background.a === 0) {
    const targetColor = bg ?? theme.primary;
    const { r, g, b } = targetColor;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255);
  }
  return theme.background;
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha;
  const g = base.g + (overlay.g - base.g) * alpha;
  const b = base.b + (overlay.b - base.b) * alpha;
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
  const grays: Record<number, RGBA> = {};
  const bgR = bg.r * 255;
  const bgG = bg.g * 255;
  const bgB = bg.b * 255;
  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  for (let i = 1; i <= 12; i++) {
    const factor = i / 12.0;
    let newR: number, newG: number, newB: number;

    if (isDark) {
      if (luminance < 10) {
        const grayValue = Math.floor(factor * 0.4 * 255);
        newR = grayValue; newG = grayValue; newB = grayValue;
      } else {
        const newLum = luminance + (255 - luminance) * factor * 0.4;
        const ratio = newLum / luminance;
        newR = Math.min(bgR * ratio, 255);
        newG = Math.min(bgG * ratio, 255);
        newB = Math.min(bgB * ratio, 255);
      }
    } else {
      if (luminance > 245) {
        const grayValue = Math.floor(255 - factor * 0.4 * 255);
        newR = grayValue; newG = grayValue; newB = grayValue;
      } else {
        const newLum = luminance * (1 - factor * 0.4);
        const ratio = newLum / luminance;
        newR = Math.max(bgR * ratio, 0);
        newG = Math.max(bgG * ratio, 0);
        newB = Math.max(bgB * ratio, 0);
      }
    }
    grays[i] = RGBA.fromInts(Math.floor(newR), Math.floor(newG), Math.floor(newB));
  }
  return grays;
}

function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
  const bgR = bg.r * 255;
  const bgG = bg.g * 255;
  const bgB = bg.b * 255;
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  let grayValue: number;
  if (isDark) {
    grayValue = bgLum < 10 ? 180 : Math.min(Math.floor(160 + bgLum * 0.3), 200);
  } else {
    grayValue = bgLum > 245 ? 75 : Math.max(Math.floor(100 - (255 - bgLum) * 0.2), 60);
  }
  return RGBA.fromInts(grayValue, grayValue, grayValue);
}

function generateSystemTheme(colors: TerminalColors, mode: "dark" | "light"): ThemeJson {
  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!);
  const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7]!);
  const transparent = RGBA.fromInts(0, 0, 0, 0);
  const isDark = mode === "dark";

  const col = (i: number) => {
    const value = colors.palette[i];
    return value ? RGBA.fromHex(value) : ansiToRgba(i);
  };

  const grays = generateGrayScale(bg, isDark);
  const textMuted = generateMutedTextColor(bg, isDark);

  const ansi = {
    red: col(1), green: col(2), yellow: col(3),
    blue: col(4), magenta: col(5), cyan: col(6),
    redBright: col(9), greenBright: col(10),
  };

  const diffAlpha = isDark ? 0.22 : 0.14;

  return {
    theme: {
      primary: ansi.cyan,
      secondary: ansi.magenta,
      accent: ansi.cyan,
      error: ansi.red,
      warning: ansi.yellow,
      success: ansi.green,
      info: ansi.cyan,
      text: fg,
      textMuted,
      selectedListItemText: bg,
      background: transparent,
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],
      border: grays[7],
      borderActive: grays[8],
      borderSubtle: grays[6],
      diffAdded: ansi.green,
      diffRemoved: ansi.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansi.greenBright,
      diffHighlightRemoved: ansi.redBright,
      diffAddedBg: tint(bg, ansi.green, diffAlpha),
      diffRemovedBg: tint(bg, ansi.red, diffAlpha),
      diffContextBg: grays[1],
      diffLineNumber: grays[6],
      diffAddedLineNumberBg: tint(grays[3], ansi.green, diffAlpha),
      diffRemovedLineNumberBg: tint(grays[3], ansi.red, diffAlpha),
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansi.blue,
      markdownLinkText: ansi.cyan,
      markdownCode: ansi.green,
      markdownBlockQuote: ansi.yellow,
      markdownEmph: ansi.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansi.blue,
      markdownListEnumeration: ansi.cyan,
      markdownImage: ansi.blue,
      markdownImageText: ansi.cyan,
      markdownCodeBlock: fg,
      syntaxComment: textMuted,
      syntaxKeyword: ansi.magenta,
      syntaxFunction: ansi.blue,
      syntaxVariable: fg,
      syntaxString: ansi.green,
      syntaxNumber: ansi.yellow,
      syntaxType: ansi.cyan,
      syntaxOperator: ansi.cyan,
      syntaxPunctuation: fg,
    },
  };
}

function getSyntaxRules(theme: Theme) {
  return [
    { scope: ["default"], style: { foreground: theme.text } },
    { scope: ["prompt"], style: { foreground: theme.accent } },
    { scope: ["extmark.file"], style: { foreground: theme.warning, bold: true } },
    { scope: ["extmark.agent"], style: { foreground: theme.secondary, bold: true } },
    { scope: ["extmark.paste"], style: { foreground: theme.background, background: theme.warning, bold: true } },
    { scope: ["comment"], style: { foreground: theme.syntaxComment, italic: true } },
    { scope: ["comment.documentation"], style: { foreground: theme.syntaxComment, italic: true } },
    { scope: ["string", "symbol"], style: { foreground: theme.syntaxString } },
    { scope: ["number", "boolean"], style: { foreground: theme.syntaxNumber } },
    { scope: ["character.special"], style: { foreground: theme.syntaxString } },
    { scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ["keyword.type"], style: { foreground: theme.syntaxType, bold: true, italic: true } },
    { scope: ["keyword.function", "function.method"], style: { foreground: theme.syntaxFunction } },
    { scope: ["keyword"], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ["keyword.import"], style: { foreground: theme.syntaxKeyword } },
    { scope: ["operator", "keyword.operator", "punctuation.delimiter"], style: { foreground: theme.syntaxOperator } },
    { scope: ["keyword.conditional.ternary"], style: { foreground: theme.syntaxOperator } },
    { scope: ["variable", "variable.parameter", "function.method.call", "function.call"], style: { foreground: theme.syntaxVariable } },
    { scope: ["variable.member", "function", "constructor"], style: { foreground: theme.syntaxFunction } },
    { scope: ["type", "module"], style: { foreground: theme.syntaxType } },
    { scope: ["constant"], style: { foreground: theme.syntaxNumber } },
    { scope: ["property"], style: { foreground: theme.syntaxVariable } },
    { scope: ["class"], style: { foreground: theme.syntaxType } },
    { scope: ["parameter"], style: { foreground: theme.syntaxVariable } },
    { scope: ["punctuation", "punctuation.bracket"], style: { foreground: theme.syntaxPunctuation } },
    { scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"], style: { foreground: theme.error } },
    { scope: ["variable.super"], style: { foreground: theme.error } },
    { scope: ["string.escape", "string.regexp"], style: { foreground: theme.syntaxKeyword } },
    { scope: ["keyword.directive"], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ["punctuation.special"], style: { foreground: theme.syntaxOperator } },
    { scope: ["keyword.modifier"], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ["keyword.exception"], style: { foreground: theme.syntaxKeyword, italic: true } },
    { scope: ["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], style: { foreground: theme.markdownHeading, bold: true } },
    { scope: ["markup.bold", "markup.strong"], style: { foreground: theme.markdownStrong, bold: true } },
    { scope: ["markup.italic"], style: { foreground: theme.markdownEmph, italic: true } },
    { scope: ["markup.list"], style: { foreground: theme.markdownListItem } },
    { scope: ["markup.quote"], style: { foreground: theme.markdownBlockQuote, italic: true } },
    { scope: ["markup.raw", "markup.raw.block"], style: { foreground: theme.markdownCode } },
    { scope: ["markup.raw.inline"], style: { foreground: theme.markdownCode, background: theme.background } },
    { scope: ["markup.link"], style: { foreground: theme.markdownLink, underline: true } },
    { scope: ["markup.link.label"], style: { foreground: theme.markdownLinkText, underline: true } },
    { scope: ["markup.link.url"], style: { foreground: theme.markdownLink, underline: true } },
    { scope: ["label"], style: { foreground: theme.markdownLinkText } },
    { scope: ["spell", "nospell"], style: { foreground: theme.text } },
    { scope: ["conceal"], style: { foreground: theme.textMuted } },
    { scope: ["string.special", "string.special.url"], style: { foreground: theme.markdownLink, underline: true } },
    { scope: ["character"], style: { foreground: theme.syntaxString } },
    { scope: ["float"], style: { foreground: theme.syntaxNumber } },
    { scope: ["comment.error"], style: { foreground: theme.error, italic: true, bold: true } },
    { scope: ["comment.warning"], style: { foreground: theme.warning, italic: true, bold: true } },
    { scope: ["comment.todo", "comment.note"], style: { foreground: theme.info, italic: true, bold: true } },
    { scope: ["namespace"], style: { foreground: theme.syntaxType } },
    { scope: ["field"], style: { foreground: theme.syntaxVariable } },
    { scope: ["type.definition"], style: { foreground: theme.syntaxType, bold: true } },
    { scope: ["keyword.export"], style: { foreground: theme.syntaxKeyword } },
    { scope: ["attribute", "annotation"], style: { foreground: theme.warning } },
    { scope: ["tag"], style: { foreground: theme.error } },
    { scope: ["tag.attribute"], style: { foreground: theme.syntaxKeyword } },
    { scope: ["tag.delimiter"], style: { foreground: theme.syntaxOperator } },
    { scope: ["markup.strikethrough"], style: { foreground: theme.textMuted } },
    { scope: ["markup.underline"], style: { foreground: theme.text, underline: true } },
    { scope: ["markup.list.checked"], style: { foreground: theme.success } },
    { scope: ["markup.list.unchecked"], style: { foreground: theme.textMuted } },
    { scope: ["diff.plus"], style: { foreground: theme.diffAdded, background: theme.diffAddedBg } },
    { scope: ["diff.minus"], style: { foreground: theme.diffRemoved, background: theme.diffRemovedBg } },
    { scope: ["diff.delta"], style: { foreground: theme.diffContext, background: theme.diffContextBg } },
    { scope: ["error"], style: { foreground: theme.error, bold: true } },
    { scope: ["warning"], style: { foreground: theme.warning, bold: true } },
    { scope: ["info"], style: { foreground: theme.info } },
    { scope: ["debug"], style: { foreground: theme.textMuted } },
  ];
}

function generateSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme(getSyntaxRules(theme));
}

function generateSubtleSyntax(theme: Theme) {
  const rules = getSyntaxRules(theme);
  return SyntaxStyle.fromTheme(
    rules.map((rule) => {
      if (rule.style.foreground) {
        const fg = rule.style.foreground;
        return {
          ...rule,
          style: {
            ...rule.style,
            foreground: RGBA.fromInts(
              Math.round(fg.r * 255),
              Math.round(fg.g * 255),
              Math.round(fg.b * 255),
              Math.round(theme.thinkingOpacity * 255),
            ),
          },
        };
      }
      return rule;
    }),
  );
}

const CUSTOM_THEME_GLOB = new Bun.Glob("themes/*.json");

async function loadCustomThemes(baseDir: string): Promise<Record<string, ThemeJson>> {
  const custom: Record<string, ThemeJson> = {};
  try {
    for await (const path of CUSTOM_THEME_GLOB.scan(baseDir)) {
      const name = path.replace(/^themes\//, "").replace(/\.json$/, "");
      const data = await Bun.file(`${baseDir}/${path}`).json();
      if (data?.theme) custom[name] = data as ThemeJson;
    }
  } catch {}
  return custom;
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: () => {
    const kv = useKV();
    const renderer = useRenderer();

    const themeName = () => (kv.get("theme") as string) ?? DEFAULT_THEME;

    const mode = createMemo<"dark" | "light">(() => {
      const colors = renderer.getTerminalColors?.();
      if (!colors?.defaultBackground) return "dark";
      const bg = RGBA.fromHex(colors.defaultBackground);
      const lum = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
      return lum > 0.5 ? "light" : "dark";
    });

    const systemThemeJson = createMemo(() => {
      const colors = renderer.getTerminalColors?.();
      if (!colors) return null;
      return generateSystemTheme(colors, mode());
    });

    const resolved = createMemo(() => {
      const name = themeName();
      const json = DEFAULT_THEMES[name] ?? systemThemeJson() ?? DEFAULT_THEMES[DEFAULT_THEME]!;
      return resolveTheme(json, mode());
    });

    const syntax = createMemo(() => generateSyntax(resolved()));
    const subtleSyntax = createMemo(() => generateSubtleSyntax(resolved()));

    return {
      get colors() { return resolved(); },
      syntax,
      subtleSyntax,
    };
  },
});