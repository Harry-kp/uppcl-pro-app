/**
 * Daily bar chart, drawn to one scale. Flagged bars = warn; the selected bar = amber.
 * With `details`, every bar is tappable and the line under the chart reads that day
 * ("Sat, 27 Sep · 6.4 kWh"); it starts on the latest day, so the value is visible without a tap.
 */
import { useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { font, useColors } from "./theme";
import { Txt } from "./ui";
import { useI18n } from "./i18n";

export function Bars({
  values, labels, details, hint, highlightLast = true, highlight, flagged = [], good = [], average = true, height = 120, summary,
}: {
  values: number[]; labels?: string[]; details?: string[]; hint?: string; highlightLast?: boolean; highlight?: number; flagged?: number[]; good?: number[]; average?: boolean; height?: number; summary: string;
}) {
  const c = useColors();
  const { t } = useI18n();
  const [w, setW] = useState(0);
  const n = values.length;
  const [picked, setPicked] = useState<number | null>(null);
  const accentAt = highlight ?? (highlightLast ? n - 1 : null); // the bar the caption talks about
  const selected = picked ?? (details ? accentAt : null);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  const finite = values.filter(Number.isFinite);
  const max = Math.max(...finite, 0.001);
  const avg = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
  const top = 14, bottom = labels ? 18 : 4, plot = height - top - bottom;
  const slot = n ? w / n : 0;
  const barW = Math.max(2, Math.min(28, slot * 0.66));
  const y = (v: number) => top + plot - (v / max) * plot;
  const labelEvery = n > 14 ? Math.ceil(n / 6) : 1;
  const fillFor = (i: number) =>
    flagged.includes(i) ? c.warn
    : good.includes(i) && i !== selected ? c.ok
    // Selection is indigo, not amber: amber/orange is reserved for "unusual" (warn) bars.
    : details ? (i === selected ? c.primary : c.bar)
    : i === accentAt ? c.primary : c.bar;

  return (
    <View>
      <View onLayout={onLayout} accessible={!details} accessibilityRole={details ? undefined : "image"} accessibilityLabel={details ? undefined : summary}>
        {w > 0 && (
          <Svg width={w} height={height}>
            <Line x1={0} x2={w} y1={top + plot} y2={top + plot} stroke={c.line} strokeWidth={1} />
            {average && avg > 0 && <Line x1={0} x2={w} y1={y(avg)} y2={y(avg)} stroke={c.muted} strokeWidth={1} strokeDasharray="3 3" />}
            {values.map((v, i) => {
              const h = Number.isFinite(v) ? Math.max(1.5, (v / max) * plot) : 0;
              return <Rect key={i} x={i * slot + (slot - barW) / 2} y={top + plot - h} width={barW} height={h} rx={Math.min(5, barW / 3)} fill={fillFor(i)} />;
            })}
            {labels?.map((l, i) => {
              if (!(i % labelEvery === 0 || i === n - 1)) return null;
              if (i !== n - 1 && n - 1 - i < labelEvery / 2) return null; // would collide with the last label
              const x = i * slot + slot / 2;
              const anchor = x < 12 ? "start" : x > w - 12 ? "end" : "middle"; // edge labels align inward
              return <SvgText key={i} x={anchor === "start" ? 0 : anchor === "end" ? w : x} y={height - 4} fontSize={10} fontFamily={font.medium} fill={c.muted} textAnchor={anchor}>{l}</SvgText>;
            })}
          </Svg>
        )}
        {w === 0 && <View style={{ height }} />}
        {details && w > 0 && (
          // One overlay; the tap's x picks the bar (full-height hit area even for thin bars, one view instead of n).
          <Pressable style={{ position: "absolute", left: 0, top: 0, width: w, height }}
            onPress={(e) => setPicked(Math.min(n - 1, Math.max(0, Math.floor(e.nativeEvent.locationX / slot))))}
            accessibilityRole="adjustable" accessibilityLabel={selected !== null ? details[selected] : summary}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) => {
              const cur = selected ?? n - 1;
              setPicked(Math.min(n - 1, Math.max(0, cur + (e.nativeEvent.actionName === "increment" ? 1 : -1))));
            }} />
        )}
      </View>
      {details && (
        <Txt v="label" color="muted" numeric style={{ marginTop: 6 }}>{selected !== null ? details[selected] : hint ?? t("tap_bar")}</Txt>
      )}
    </View>
  );
}
