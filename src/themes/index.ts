import { createContext, useContext } from "react";
import type { InkTheme } from "./types";
import { themes, DEFAULT_THEME_ID } from "./definitions";

export const ThemeContext = createContext<InkTheme>(themes[DEFAULT_THEME_ID]);

export function useTheme(): InkTheme {
  return useContext(ThemeContext);
}

export function getTheme(id: string): InkTheme {
  return themes[id] ?? themes[DEFAULT_THEME_ID];
}

export function listThemes(): { id: string; name: string }[] {
  return Object.values(themes).map(t => ({ id: t.id, name: t.name }));
}

export { type InkTheme } from "./types";
export { themes, DEFAULT_THEME_ID } from "./definitions";
