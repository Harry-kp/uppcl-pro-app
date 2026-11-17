import { expect, test } from "bun:test";
import { dark, light } from "../src/palette";

// WCAG AA: every text colour on every surface it's used on, both themes (src/palette.ts promises ≥ 4.5:1).
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("text tokens keep 4.5:1 on their backgrounds", () => {
  for (const t of [light, dark]) {
    const bad: string[] = [];
    for (const fg of ["text", "muted", "primary", "accent", "ok", "warn", "critical"] as const)
      for (const bg of ["bg", "surface", "pill", "accentSoft", "criticalSoft"] as const)
        if (ratio(t[fg], t[bg]) < 4.5) bad.push(`${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
    for (const [fg, bg] of [["pillText", "pill"], ["onPrimary", "primary"], ["big", "glow"]] as const)
      if (ratio(t[fg], t[bg]) < 4.5) bad.push(`${fg} on ${bg}`);
    expect(bad).toEqual([]);
  }
});
