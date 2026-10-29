/**
 * Home-screen widget: the one answer (days left / amount due) without opening the app.
 * It renders from a small snapshot the app writes whenever Home has fresh data (and the
 * background alert check refreshes). This file runs headless too, so it imports nothing heavy.
 */
import type { ReactNode } from "react";
import { Platform } from "react-native";
import { FlexWidget, TextWidget, requestWidgetUpdate, type WidgetTaskHandler } from "react-native-android-widget";
import { File, Paths } from "expo-file-system";
import en from "../messages/en.json";
import hi from "../messages/hi.json";

export const WIDGET_NAME = "Meter";       // 2×2: the one answer
export const WIDE_WIDGET_NAME = "MeterWide"; // 4×2: the answer + [Pay] [No power?]
const NAMES = [WIDGET_NAME, WIDE_WIDGET_NAME];

/** Already-localised strings, so the headless widget needs no app state. */
export interface WidgetSnapshot {
  label: string;        // "Balance lasts about" / "Amount due" / "September so far"
  big: string;          // "8" / "₹1,922"
  unit: string;         // "days" / ""
  line: string;         // "₹540 left" / "Due in 6 days"
  tone: "ok" | "warn" | "critical";
  updated: string;      // ISO time the data was fetched
  lang: "en" | "hi";
  status?: string;      // the same answer without money: "Bill due" / "Paid" / "Recharge soon" (fingerprint lock on)
  pay?: boolean;        // a bill or recharge is due: the wide widget offers the button
  locked?: boolean;     // app lock is on: no ₹ amounts outside the app
}

const file = new File(Paths.document, "widget-snapshot-v1.json");

function readSnapshot(): WidgetSnapshot | null {
  try { return file.exists ? (JSON.parse(file.textSync()) as WidgetSnapshot) : null; } catch { return null; }
}

/** Save and push to any widgets on the home screen. Safe to call often. */
let lastSaved = "";
export function saveSnapshot(snap: WidgetSnapshot): void {
  const json = JSON.stringify(snap);
  if (json === lastSaved) return; // Home re-renders often; redraw the widget only when what it shows changed
  lastSaved = json;
  try { file.write(json); } catch { /* widget is a convenience */ }
  redraw(snap);
}

function redraw(snap: WidgetSnapshot | null) {
  if (Platform.OS === "ios") return toIos(snap);
  for (const widgetName of NAMES) {
    void requestWidgetUpdate({ widgetName, renderWidget: (w) => (widgetName === WIDE_WIDGET_NAME ? wideView(snap, w.width) : widgetView(snap, w.width)) }).catch(() => {});
  }
}

// iOS: the widget extension (targets/widget/BijliWidget.swift) reads this from the App Group, with the strings it
// can't compute (it has no string table) and a short answer for the ~20-character Lock Screen line.
const APP_GROUP = "group.com.harrykp.uppclpro";
function toIos(snap: WidgetSnapshot | null) {
  try {
    // Required lazily: the module is iOS-only native code, and this file also runs as Android's headless widget task.
    const { ExtensionStorage } = require("@bacons/apple-targets") as typeof import("@bacons/apple-targets");
    const store = new ExtensionStorage(APP_GROUP);
    if (!snap) store.remove("snapshot");
    else {
      const m = (snap.lang === "hi" ? hi : en).app;
      store.set("snapshot", JSON.stringify({
        ...snap,
        short: snap.unit ? `${snap.big} ${snap.unit}` : snap.status ?? snap.label, // days are not money; the rest is a status word
        strings: { tapRefresh: m.widget_tap_refresh, openToUpdate: m.widget_open_to_update, updated: m.updated_at,
          pay: snap.unit ? m.qa_recharge : m.qa_pay, noPower: m.qa_report, a11yPay: m.widget_a11y_pay, a11yNoPower: m.widget_a11y_no_power },
      }));
    }
    ExtensionStorage.reloadWidget();
  } catch { /* no App Group on this install (free signing): the widget says so itself */ }
}

/** The app lock was switched: redraw now, so amounts don't stay on the home screen until the next refresh. */
export function setWidgetLocked(locked: boolean): void {
  const snap = readSnapshot();
  if (snap && !!snap.locked !== locked) saveSnapshot({ ...snap, locked });
}

export function clearSnapshot(): void {
  lastSaved = "";
  try { if (file.exists) file.delete(); } catch { /* already gone */ }
  redraw(null);
}

// Same Dusk tokens as src/theme.ts (hex only: widgets can't read the app theme).
const LIGHT = { bg: "#F3F3F8", text: "#1B1C2E", muted: "#585A73", ok: "#2E7550", warn: "#A04A14", critical: "#B3261E", big: "#1B1C2E", glow: "#FBE8C6", button: "#3B47A8", onButton: "#FFFFFF", soft: "#E3E4F4", onSoft: "#2B3380" } as const;
const DARK = { bg: "#181A2E", text: "#E7E7F3", muted: "#A2A4BD", ok: "#7FD1A0", warn: "#F29A5E", critical: "#F4A59C", big: "#FFE3B0", glow: "#3A2F1E", button: "#FFE3B0", onButton: "#1B1C2E", soft: "#2A2D48", onSoft: "#E7E7F3" } as const;
type Palette = { [K in keyof typeof LIGHT]: `#${string}` };

/**
 * How old the snapshot is, decided at draw time (the widget redraws without the app). The background check
 * runs every ~12 h and Android may delay it past a day, so: over a day, everything greys and says "as of";
 * over three days, the number goes (an old "₹1,485 due" could get paid twice).
 */
const DAY = 86_400_000;
function age(snap: WidgetSnapshot, now = Date.now()): "fresh" | "stale" | "old" {
  const ms = now - new Date(snap.updated).getTime();
  return ms > 3 * DAY ? "old" : ms > DAY ? "stale" : "fresh";
}

/** What the widget may show right now: staleness and the app lock applied. Pure, so it is tested. */
export function shown(snap: WidgetSnapshot, now = Date.now()) {
  const m = (snap.lang === "hi" ? hi : en).app;
  const fresh = age(snap, now);
  const big = fresh === "old" ? m.widget_open_to_update : snap.locked && snap.status ? snap.status : snap.big;
  return {
    big,
    unit: fresh === "old" || snap.locked ? "" : snap.unit,
    line: fresh !== "fresh" ? m.widget_tap_refresh : snap.locked ? "" : snap.line,
    muted: fresh !== "fresh",
    wordy: !/\d/.test(big), // "Paid", a status word, Hindi: words in the text font, smaller
    pay: !!snap.pay && fresh === "fresh", // an old "Pay" invites paying twice
  };
}

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
  const m = (hindi ? hi : en).app;
  const bold = hindi ? "AnekDevanagari_700Bold" : "AnekLatin_700Bold";
  const regular = hindi ? "AnekDevanagari_400Regular" : "AnekLatin_400Regular";
  // App lock on: the answer as a word, never an amount (the home screen is visible to anyone holding the phone).
  const { big, unit, line, muted, wordy } = snap ? shown(snap) : { big: "", unit: "", line: "", muted: false, wordy: false };
  const accessibility = snap ? `${snap.label} ${big} ${unit}. ${line} ${updatedAt(snap)}` : m.widget_setup;
  return (
    <FlexWidget
      // Home, not "wherever the app was left": the widget shows Home's number, so a tap should land on it.
      clickAction="OPEN_URI"
      clickActionData={{ uri: "uppclpro://" }}
      accessibilityLabel={accessibility}
      style={{ height: "match_parent", width: "match_parent", flexDirection: "column", justifyContent: "space-between" }}
    >
      <TextWidget text={snap ? snap.label : "Bijli Saathi"} style={{ fontSize: 13, fontFamily: regular, color: c.muted }} maxLines={1} truncate="END" />
      {snap ? (
        <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end" }}>
          <TextWidget text={big} maxLines={wordy ? 2 : 1}
            style={{ fontSize: wordy ? 22 : 40, fontFamily: wordy ? bold : "AnekLatin_800ExtraBold", adjustsFontSizeToFit: !wordy,
              color: muted ? c.muted : snap.tone === "critical" ? c.critical : c.big }} />
          {!!unit && <TextWidget text={` ${unit}`} style={{ fontSize: 15, fontFamily: bold, color: c.muted, marginBottom: 6 }} />}
        </FlexWidget>
      ) : (
        <TextWidget text={m.widget_setup} style={{ fontSize: 15, fontFamily: bold, color: c.text }} maxLines={2} />
      )}
      {snap && (
        <FlexWidget style={{ flexDirection: "column" }}>
          {/* One line: a second one pushes "updated …" (the staleness cue) out of a 2×2 widget in Hindi at large font. */}
          {!!line && <TextWidget text={line} style={{ fontSize: 13, fontFamily: bold, color: muted || snap.tone === "ok" ? c.text : c[snap.tone] }} maxLines={1} truncate="END" />}
          <TextWidget text={updatedAt(snap)} style={{ fontSize: 11, fontFamily: regular, color: c.muted }} maxLines={1} />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

/** The card both sizes sit on. */
function Card({ c, width, children }: { c: Palette; width: number; children: ReactNode }) {
  const card = (
    <FlexWidget style={{ height: "match_parent", width: "match_parent", borderRadius: 24, padding: 16, flexDirection: "row",
      backgroundGradient: { from: c.glow, to: c.bg, orientation: "TR_BL" } }}>
      {children}
    </FlexWidget>
  );
  // Before Android 12 the launcher pads widgets yet reports a size that ignores it, so the drawing overflows and its
  // right edge is cut. Measured on MIUI (Redmi Note 5 Pro): ~12dp over on 2×2, ~23dp on 4×2. Leave that free.
  // ponytail: a measured ratio, not the host's real padding; revisit if another launcher still clips.
  const inset = Math.max(20, Math.round(width * 0.075));
  return Number(Platform.Version) < 31
    ? <FlexWidget style={{ height: "match_parent", width: "match_parent", paddingRight: inset }}>{card}</FlexWidget>
    : card;
}

/** A 48dp+ button that opens one job in the app (its own tap target and TalkBack label). */
function WidgetButton({ label, a11y, uri, c, primary }: { label: string; a11y: string; uri: string; c: Palette; primary?: boolean }) {
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri }} accessibilityLabel={a11y}
      style={{ height: 52, width: "match_parent", borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 8,
        backgroundColor: primary ? c.button : c.soft }}>
      <TextWidget text={label} maxLines={1} truncate="END"
        style={{ fontSize: 15, fontFamily: "AnekLatin_700Bold", color: primary ? c.onButton : c.onSoft }} />
    </FlexWidget>
  );
}

function Wide({ snap, c, width }: { snap: WidgetSnapshot | null; c: Palette; width: number }) {
  const m = (snap?.lang === "hi" ? hi : en).app;
  const pay = !!snap && shown(snap).pay; // the app re-checks before paying anyway
  return (
    <Card c={c} width={width}>
      <FlexWidget style={{ flex: 1, height: "match_parent" }}><Body snap={snap} c={c} /></FlexWidget>
      {snap && (
        <FlexWidget style={{ width: 132, height: "match_parent", marginLeft: 12, flexDirection: "column", justifyContent: "center" }}>
          {pay && <WidgetButton primary label={snap.unit ? m.qa_recharge : m.qa_pay} a11y={m.widget_a11y_pay} uri="uppclpro://quick/pay" c={c} />}
          {pay && <FlexWidget style={{ height: 8, width: 1 }} />}
          <WidgetButton primary={!pay} label={m.qa_report} a11y={m.widget_a11y_no_power} uri="uppclpro://quick/sms" c={c} />
        </FlexWidget>
      )}
    </Card>
  );
}

export function widgetView(snap: WidgetSnapshot | null, width: number) {
  return { light: <Card c={LIGHT} width={width}><Body snap={snap} c={LIGHT} /></Card>, dark: <Card c={DARK} width={width}><Body snap={snap} c={DARK} /></Card> };
}

export function wideView(snap: WidgetSnapshot | null, width: number) {
  return { light: <Wide snap={snap} c={LIGHT} width={width} />, dark: <Wide snap={snap} c={DARK} width={width} /> };
}

// Redraws only (every 30 min, and when added or resized): never fetches. Age is re-judged each time.
export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetInfo, widgetAction, renderWidget }) => {
  if (widgetAction === "WIDGET_ADDED" || widgetAction === "WIDGET_UPDATE" || widgetAction === "WIDGET_RESIZED") {
    const snap = readSnapshot();
    renderWidget(widgetInfo.widgetName === WIDE_WIDGET_NAME ? wideView(snap, widgetInfo.width) : widgetView(snap, widgetInfo.width));
  }
};
