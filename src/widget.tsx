/**
 * Home-screen widget: the one answer (days left / amount due) without opening the app.
 * It renders from a small snapshot the app writes whenever Home has fresh data (and the
 * background alert check refreshes). This file runs headless too, so it imports nothing heavy.
 */
import { FlexWidget, TextWidget, requestWidgetUpdate, type WidgetTaskHandler } from "react-native-android-widget";
import { File, Paths } from "expo-file-system";
import en from "../messages/en.json";
import hi from "../messages/hi.json";

export const WIDGET_NAME = "Meter";

/** Already-localised strings, so the headless widget needs no app state. */
export interface WidgetSnapshot {
  label: string;        // "Balance lasts about" / "Amount due" / "September so far"
  big: string;          // "8" / "₹1,922"
  unit: string;         // "days" / ""
  line: string;         // "₹540 left" / "Due in 6 days"
  tone: "ok" | "warn" | "critical";
  updated: string;      // ISO time the data was fetched
  lang: "en" | "hi";
}

const file = new File(Paths.document, "widget-snapshot-v1.json");

function readSnapshot(): WidgetSnapshot | null {
  try { return file.exists ? (JSON.parse(file.textSync()) as WidgetSnapshot) : null; } catch { return null; }
}

/** Save and push to any widgets on the home screen. Safe to call often. */
export function saveSnapshot(snap: WidgetSnapshot): void {
  try { file.write(JSON.stringify(snap)); } catch { /* widget is a convenience */ }
  void requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => widgetView(snap) }).catch(() => {});
}

export function clearSnapshot(): void {
  try { if (file.exists) file.delete(); } catch { /* already gone */ }
  void requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => widgetView(null) }).catch(() => {});
}

// Same Dusk tokens as src/theme.ts (hex only: widgets can't read the app theme).
const LIGHT = { bg: "#F3F3F8", text: "#1B1C2E", muted: "#585A73", ok: "#2E7550", warn: "#A04A14", critical: "#B3261E", big: "#1B1C2E", glow: "#FBE8C6" } as const;
const DARK = { bg: "#181A2E", text: "#E7E7F3", muted: "#A2A4BD", ok: "#7FD1A0", warn: "#F29A5E", critical: "#F4A59C", big: "#FFE3B0", glow: "#3A2F1E" } as const;
type Palette = typeof LIGHT | typeof DARK;

/**
 * A fixed time, not "2 min ago": widgets redraw at most every 30 minutes, so relative
 * times go stale and lie (BUG-044). Today → "updated 4:12 am"; earlier → "updated 28 Sep".
 */
function updatedAt(snap: WidgetSnapshot): string {
  const locale = snap.lang === "hi" ? "hi-IN" : "en-IN";
  const d = new Date(snap.updated);
  const today = d.toDateString() === new Date().toDateString();
  const when = today
    ? d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return (snap.lang === "hi" ? hi : en).app.updated_at.replace("{when}", when);
}

function Body({ snap, c }: { snap: WidgetSnapshot | null; c: Palette }) {
  const hindi = snap?.lang === "hi";
  const bold = hindi ? "AnekDevanagari_700Bold" : "AnekLatin_700Bold";
  const regular = hindi ? "AnekDevanagari_400Regular" : "AnekLatin_400Regular";
  const accessibility = snap ? `${snap.label} ${snap.big} ${snap.unit}. ${snap.line}` : en.app.widget_setup;
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={accessibility}
      style={{
        height: "match_parent", width: "match_parent", borderRadius: 24, padding: 16,
        flexDirection: "column", justifyContent: "space-between",
        backgroundGradient: { from: c.glow, to: c.bg, orientation: "TR_BL" },
      }}
    >
      <TextWidget text={snap ? snap.label : "UPPCL Pro"} style={{ fontSize: 13, fontFamily: regular, color: c.muted }} maxLines={1} truncate="END" />
      {snap ? (
        <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end" }}>
          <TextWidget text={snap.big} style={{ fontSize: 40, fontFamily: "AnekLatin_800ExtraBold", color: snap.tone === "critical" ? c.critical : c.big, adjustsFontSizeToFit: true }} maxLines={1} />
          {!!snap.unit && <TextWidget text={` ${snap.unit}`} style={{ fontSize: 15, fontFamily: bold, color: c.muted, marginBottom: 6 }} />}
        </FlexWidget>
      ) : (
        <TextWidget text={(hindi ? hi : en).app.widget_setup} style={{ fontSize: 15, fontFamily: bold, color: c.text }} maxLines={2} />
      )}
      {snap && (
        <FlexWidget style={{ flexDirection: "column" }}>
          <TextWidget text={snap.line} style={{ fontSize: 13, fontFamily: bold, color: snap.tone === "ok" ? c.text : c[snap.tone] }} maxLines={2} truncate="END" />
          <TextWidget text={updatedAt(snap)} style={{ fontSize: 11, fontFamily: regular, color: c.muted }} maxLines={1} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

export function widgetView(snap: WidgetSnapshot | null) {
  return { light: <Body snap={snap} c={LIGHT} />, dark: <Body snap={snap} c={DARK} /> };
}

export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetAction, renderWidget }) => {
  if (widgetAction === "WIDGET_ADDED" || widgetAction === "WIDGET_UPDATE" || widgetAction === "WIDGET_RESIZED") {
    renderWidget(widgetView(readSnapshot()));
  }
};
