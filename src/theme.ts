/**
 * "Dusk" — indigo evening + lamp-amber. Every text colour here was checked
 * against its background at ≥ 4.5:1 (WCAG AA) in both schemes; re-check any
 * change. Amber marks only "today" and the balance glow; terracotta (critical)
 * is reserved for ≤ 2 days of balance.
 */
import { Appearance, useColorScheme } from "react-native";
import { keystore } from "./boot";

const light = {
  bg: "#F3F3F8",
  surface: "#FFFFFF",
  line: "#E3E4EE",
  text: "#1B1C2E",
  muted: "#585A73",
  primary: "#3B47A8",
  onPrimary: "#FFFFFF",
  accent: "#8F5700",
  ok: "#2E7550",
  warn: "#A04A14",
  critical: "#B3261E",
  bar: "#D5D8F0",
  track: "#E6E7F6",
  fill: "#E0A33A",
  pill: "#E4E6F7",
  pillText: "#3B47A8",
  glow: "#FBE8C6",
  big: "#1B1C2E",
  accentSoft: "#F6EAD6",
  criticalSoft: "#F9E3E1",
};

const dark: typeof light = {
  bg: "#0F1020",
  surface: "#181A2E",
  line: "#26283F",
  text: "#E7E7F3",
  muted: "#A2A4BD",
  primary: "#A8B0FF",
  onPrimary: "#0F1020",
  accent: "#FFC466",
  ok: "#7FD1A0",
  warn: "#F29A5E",
  critical: "#F4A59C",
  bar: "#30345E",
  track: "#26294A",
  fill: "#FFC466",
  pill: "#2A2E57",
  pillText: "#C9CEFF",
  glow: "#3A2F1E",
  big: "#FFE3B0",
  accentSoft: "#2E2616",
  criticalSoft: "#3A1F1E",
};

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
