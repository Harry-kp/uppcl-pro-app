/**
 * "Dusk" — indigo evening + lamp-amber. Every text colour here was checked
 * against its background at ≥ 4.5:1 (WCAG AA) in both schemes; re-check any
 * change. Amber marks only "today" and the balance glow; terracotta (critical)
 * is reserved for ≤ 2 days of balance.
 */
import { Appearance, useColorScheme } from "react-native";
import { keystore } from "./boot";
import { dark, light } from "./palette";

export { dark, light };


export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

/** Anek Latin + Anek Devanagari (Ek Type): one family for English and Hindi. */
export const font = {
  regular: "AnekLatin_400Regular",
  medium: "AnekLatin_500Medium",
  semibold: "AnekLatin_600SemiBold",
  bold: "AnekLatin_700Bold",
  extrabold: "AnekLatin_800ExtraBold",
  hiRegular: "AnekDevanagari_400Regular",
  hiSemibold: "AnekDevanagari_600SemiBold",
  hiBold: "AnekDevanagari_700Bold",
} as const;

export const radius = { card: 24, tile: 18, button: 14, pill: 999 } as const;
export const space = { gutter: 16, gap: 12 } as const;

/** App theme override: "system" follows the phone. Saved on the phone; applied at startup in app/_layout.tsx. */
export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "app_theme";
export function getThemeChoice(): ThemeChoice {
  const v = keystore.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}
export function setThemeChoice(v: ThemeChoice): void {
  if (v === "system") keystore.removeItem(THEME_KEY); else keystore.setItem(THEME_KEY, v);
  Appearance.setColorScheme(v === "system" ? "unspecified" : v);
}

/** Android reports the phone's own scheme again after a configuration change (text size, display size, dark mode),
 *  which silently drops the override above: put the saved choice back whenever the two disagree (UX-R12). */
let keeping = false;
export function keepThemeChoice(): void {
  if (keeping) return;
  keeping = true;
  Appearance.addChangeListener(({ colorScheme }) => {
    const v = getThemeChoice();
    if (v !== "system" && colorScheme !== v) Appearance.setColorScheme(v);
  });
}
