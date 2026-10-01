/** Small design-system primitives. Every colour comes from theme.ts. */
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View,
  type DimensionValue, type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { font, radius, space, useColors, type Colors } from "./theme";
import { useI18n } from "./i18n";
import { Icon, type IconName } from "./icons";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

type Variant = "hero" | "title" | "heading" | "value" | "body" | "label" | "caption";

const SIZES: Record<Variant, { size: number; line: number; weight: Weight }> = {
  hero: { size: 64, line: 64, weight: "extrabold" },
  title: { size: 28, line: 32, weight: "bold" },
  heading: { size: 17, line: 22, weight: "bold" },
  value: { size: 20, line: 24, weight: "bold" },
  body: { size: 15, line: 21, weight: "regular" },
  label: { size: 13, line: 18, weight: "medium" },
  caption: { size: 12, line: 16, weight: "regular" },
};

/**
 * All app text. The language picks the family: Anek Devanagari carries matching Latin
 * digits, so Hindi lines never mix in a fallback font (BUG-029). `numeric` only turns on
 * tabular figures. `simple` line breaking stops Android dropping the last Devanagari word
 * (BUG-002/030). The hero number grows at most 1.25× with the system font size so it
 * can't overflow a small phone; everything else scales fully.
 */
export type Weight = "regular" | "medium" | "semibold" | "bold" | "extrabold";

/** The font file for a weight in the current language. Never set fontFamily on text directly:
 *  a Latin family on Hindi text makes Android mis-measure and drop words (BUG-039). */
export function familyFor(weight: Weight, hindi: boolean): string {
  if (!hindi) return font[weight];
  return weight === "regular" || weight === "medium" ? font.hiRegular : weight === "semibold" ? font.hiSemibold : font.hiBold;
}

export function Txt({
  v = "body", weight, color, numeric, style, children, numberOfLines,
}: {
  v?: Variant; weight?: Weight; color?: keyof Colors; numeric?: boolean; style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number;
}) {
  const c = useColors();
  const { lang } = useI18n();
  const s = SIZES[v];
  const hindi = lang === "hi";
  const family = familyFor(weight ?? s.weight, hindi);
  // The "·" glyph in Anek Devanagari has uneven side bearings, so the gap around it changed with the
  // neighbouring letters. Rendering just the separator in the Latin face keeps it even (UX-037).
  const body = hindi && typeof children === "string"
    ? children.split(/[ \u00A0]·[ \u00A0]/).flatMap((part, i) => i === 0 ? [part] : [<Text key={i} style={{ fontFamily: familyFor(weight ?? s.weight, false) }}>{"\u00A0·\u00A0"}</Text>, part])
    : children;
  return (
    <Text
      numberOfLines={numberOfLines}
      textBreakStrategy="simple"
      maxFontSizeMultiplier={v === "hero" ? 1.25 : undefined}
      // Android's default font padding plus Anek Devanagari's tall metrics pushed Hindi text above centre (UX-045).
      style={[{ fontFamily: family, fontSize: s.size, lineHeight: hindi ? s.line * 1.2 : s.line, color: c[color ?? "text"] }, hindi && styles.noFontPadding, numeric && styles.tabular, style]}
    >
      {/* Devanagari marks overhang the width Android measures; a trailing thin space gives them room so
          short labels don't wrap their last word onto a hidden line (BUG-039). */}
      {body}{hindi && typeof children === "string" ? "\u2009" : null}
    </Text>
  );
}

export function Screen({ children, onRefresh, refreshing = false, footer }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; footer?: ReactNode }) {
  const c = useColors();
  // Show the pull-to-refresh spinner only for a pull the user made, not for every background load.
  const [pulled, setPulled] = useState(false);
  const spinning = pulled && refreshing;
  useEffect(() => { if (pulled && !refreshing) setPulled(false); }, [pulled, refreshing]);
  // Content scrolled flush against the clock/battery looked cramped: clip a little below the status bar
  // (insets can read 0 on Android 9, hence currentHeight), and end clear of the system nav bar.
  const insets = useSafeAreaInsets();
  const top = Math.max(insets.top, StatusBar.currentHeight ?? 0) + 6;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: top }}>
      <ScrollView
        keyboardShouldPersistTaps="handled" // a tap on a list row acts at once, even with the keyboard up
        contentContainerStyle={[styles.scroll, { paddingBottom: footer ? 24 : 32 + insets.bottom }]}
        refreshControl={onRefresh ? <RefreshControl refreshing={spinning} onRefresh={() => { setPulled(true); onRefresh(); }} tintColor={c.primary} colors={[c.primary]} progressBackgroundColor={c.surface} /> : undefined}
      >
        {children}
      </ScrollView>
      {/* Pinned action (e.g. "File complaint"): always in reach, above the system nav bar. */}
      {footer && (
        <View style={{ paddingHorizontal: space.gutter, paddingTop: 12, paddingBottom: 12 + insets.bottom, gap: 6, backgroundColor: c.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }}>
          {footer}
        </View>
      )}
    </View>
  );
}

/** A titled group. One spacing rule for every screen (sections used to sit 4/8/12 apart). */
export function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View>
        <Txt v="heading">{title}</Txt>
        {caption && <Txt v="caption" color="muted">{caption}</Txt>}
      </View>
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>;
}

export function Button({
  label, onPress, kind = "primary", busy, disabled, icon,
}: { label: string; onPress: () => void; kind?: "primary" | "soft" | "critical"; busy?: boolean; disabled?: boolean; icon?: IconName }) {
  const c = useColors();
  const bg = kind === "primary" ? c.primary : kind === "critical" ? c.critical : c.pill;
  const fg = kind === "primary" ? c.onPrimary : kind === "critical" ? c.surface : c.pillText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {/* Busy keeps its words beside the spinner ("Signing in…"): a bare spinner doesn't say what's happening.
          A trailing icon says where the tap goes (e.g. "opens UPPCL's site"). */}
      <View style={styles.buttonRow}>
        {busy && <ActivityIndicator color={fg} />}
        <Txt v="heading" style={{ color: fg, textAlign: "center", flexShrink: 1 }}>{label}</Txt>
        {icon && !busy && <Icon name={icon} size={18} color={fg} />}
      </View>
    </Pressable>
  );
}

export type Tone = "ok" | "accent" | "warn" | "critical";

/** Colour + icon + word for every status: people read the colour and shape first; the word confirms. */
const TONE_ICON: Record<Tone, IconName> = { ok: "checkCircle", accent: "schedule", warn: "warning", critical: "warning" };

function toneColors(c: Colors, tone: Tone) {
  return tone === "ok" ? { bg: c.pill, fg: c.ok }
    : tone === "critical" ? { bg: c.criticalSoft, fg: c.critical }
    : { bg: c.accentSoft, fg: tone === "warn" ? c.warn : c.accent };
}

/** Status pill: never colour alone — always an icon and a word too. */
export function Pill({ label, tone = "ok", icon, flipIcon }: { label: string; tone?: Tone; icon?: IconName; flipIcon?: boolean }) {
  const c = useColors();
  const { bg, fg } = toneColors(c, tone);
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <View style={flipIcon && { transform: [{ scaleY: -1 }] }}><Icon name={icon ?? TONE_ICON[tone]} size={12} color={fg} /></View>
      <Txt v="caption" weight="bold" style={{ color: fg }}>{label}</Txt>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange(v: T): void }) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={[styles.seg, { backgroundColor: c.pill }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
            style={[styles.segItem, on && { backgroundColor: c.surface }]}>
            <Txt v="label" color={on ? "text" : "muted"} weight={on ? "bold" : "medium"} style={{ textAlign: "center" }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tinted note with a tone icon; ends with something the user can act on. */
export function Insight({ text, tone = "accent", icon }: { text: string; tone?: Tone; icon?: IconName }) {
  const c = useColors();
  const { bg, fg } = toneColors(c, tone);
  return (
    <View style={[styles.insight, { backgroundColor: bg }]}>
      <Icon name={icon ?? (tone === "accent" ? "info" : TONE_ICON[tone])} size={18} color={fg} />
      <Txt v="label" style={{ flex: 1 }}>{text}</Txt>
    </View>
  );
}

/**
 * Lamp-light glow from the top-right corner (the Dusk "balance" signature).
 * Place first inside a container. Sized from onLayout in pixels: percentage
 * sizes on react-native-svg left a hard-edged box on Android.
 */
export const Glow = memo(function Glow() {
  const c = useColors();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((s) => (s && s.w === w && s.h === h ? s : { w, h })); // same size → no SVG redraw
      }}>
      {size && (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <RadialGradient id="glow" gradientUnits="userSpaceOnUse" cx={size.w} cy={0} r={size.h} /* reaches zero before the bottom and left edges, so no seam */ fx={size.w} fy={0}>
              <Stop offset="0" stopColor={c.glow} stopOpacity={1} />
              <Stop offset="1" stopColor={c.glow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#glow)" />
        </Svg>
      )}
    </View>
  );
});

/** The launcher icon (lamp-amber bolt on Dusk ink) — same in both themes; the hairline keeps its edge on dark backgrounds. */
export function AppIcon({ size = 64 }: { size?: number }) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: "#181A2E", borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, alignItems: "center", justifyContent: "center" }}>
      <Icon name="boltFill" size={size * 0.53} color="#FFC466" />
    </View>
  );
}

/** Title row with a back arrow, for screens pushed on top of the tabs. */
export function BackHeader({ title }: { title: string }) {
  const c = useColors();
  const { t } = useI18n();
  return (
    <View style={styles.backRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
        <Icon name="arrowBack" size={24} color={c.text} />
      </Pressable>
      <Txt v="title" style={{ flex: 1 }} numberOfLines={1}>{title}</Txt>
    </View>
  );
}

/** Shown when a refresh failed but we still have the last good data (offline, UPPCL down). */
export function Centered({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[styles.centered, { backgroundColor: c.bg }]}>{children}</View>;
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingTop: 8, gap: 12 },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  choice: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  tabular: { fontVariant: ["tabular-nums"] },
  noFontPadding: { includeFontPadding: false, textAlignVertical: "center" },
  scroll: { padding: space.gutter, gap: space.gap, paddingBottom: 32 },
  section: { gap: 8, marginTop: 8 },
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  buttonRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  button: { borderRadius: radius.button, paddingVertical: 13, paddingHorizontal: 16, minHeight: 48, justifyContent: "center" },
  pill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4 },
  seg: { flexDirection: "row", borderRadius: 14, padding: 3 },
  segItem: { flex: 1, borderRadius: 11, minHeight: 48, justifyContent: "center", paddingHorizontal: 4 }, // labels wrap, never touch the edge
  insight: { flexDirection: "row", gap: 10, borderRadius: 16, padding: 12, alignItems: "flex-start" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: -8 },
  backBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  stale: { flexDirection: "row", gap: 8, alignItems: "center", borderRadius: 14, padding: 10 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});

/**
 * Bottom sheet for one small choice or input (Settings rows open these). Tap outside or Back to close.
 */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,10,25,0.45)" }]} />
        {/* Never taller than the screen below the status bar: long lists scroll inside. */}
        <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: 16 + insets.bottom, maxHeight: "100%", marginTop: Math.max(insets.top, StatusBar.currentHeight ?? 0) + 24 }]}>
          <View style={[styles.grabber, { backgroundColor: c.line }]} />
          {/* "handled": a tap on Save acts on the first press instead of only closing the keyboard. */}
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false} contentContainerStyle={{ gap: 12 }}>
            <Txt v="heading">{title}</Txt>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A one-of-N list for a Sheet: radio circle + label, 56 dp rows. */
export function Choices<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange(v: T): void }) {
  const c = useColors();
  return (
    <View>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)} style={styles.choice}>
            <View style={[styles.radio, { borderColor: on ? c.primary : c.muted }]}>{on && <View style={[styles.radioDot, { backgroundColor: c.primary }]} />}</View>
            <Txt v="body" weight={on ? "semibold" : "regular"} style={{ flex: 1 }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Loading placeholder shaped like what's coming (a line, a number, a chart), so the layout is there at once and
 * nothing jumps when data lands. Pulses on the native driver: costs no JS work on slow phones.
 */
export function Skeleton({ w = "100%", h = 14, r = 8, style }: { w?: DimensionValue; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{ width: w, height: h, borderRadius: r, backgroundColor: c.track, opacity: pulse }, style]} />;
}

/** True once something has been loading for `ms`: time to say it's UPPCL being slow, not the app stuck. */
export function useSlow(loading: boolean, ms = 6000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const id = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(id);
  }, [loading, ms]);
  return slow;
}

/** The line shown under a placeholder once loading is slow. Announced to screen readers. */
export function SlowNote({ loading }: { loading: boolean }) {
  const { t } = useI18n();
  const slow = useSlow(loading);
  if (!slow) return null;
  return <View accessibilityLiveRegion="polite"><Txt v="caption" color="muted" style={{ textAlign: "center" }}>{t("loading_slow")}</Txt></View>;
}

/** Placeholder list rows (title + caption on the left, amount on the right), for lists inside a Card. */
export function SkeletonRows({ n = 3 }: { n?: number }) {
  const c = useColors();
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={[skel.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
          <View style={{ flex: 1, gap: 8 }}><Skeleton w="55%" h={16} /><Skeleton w="35%" h={12} /></View>
          <Skeleton w={64} h={18} />
        </View>
      ))}
    </>
  );
}

/** Placeholder for a summary card with a chart: a heading, a big number and the bars. */
export function SkeletonChartCard({ chart = 120 }: { chart?: number }) {
  return (
    <Card>
      <Skeleton w="40%" h={14} />
      <Skeleton w="55%" h={30} />
      <Skeleton h={chart} r={12} />
    </Card>
  );
}

const skel = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 64 },
});
