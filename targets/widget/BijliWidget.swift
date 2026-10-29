// The iOS widget: the same one answer as the Android widget (src/widget.tsx), from the snapshot the app writes
// into the App Group. Home Screen: small (the answer) and medium (+ Pay / No power). Lock Screen: a status word
// only (anyone can see it), never ₹. `shown` mirrors src/widget.tsx `shown()`; keep the two in step.
import SwiftUI
import WidgetKit

let appGroup = "group.com.harrykp.uppclpro"

struct WidgetStrings: Codable {
  var tapRefresh: String, openToUpdate: String, updated: String
  var pay: String, noPower: String, a11yPay: String, a11yNoPower: String
}

struct Snapshot: Codable {
  var label: String, big: String, unit: String, line: String, tone: String, updated: String, lang: String
  var status: String?, pay: Bool?, locked: Bool?, short: String?, strings: WidgetStrings?
}

/// No App Group (a free-Apple-ID install may not get one), no data yet, or the snapshot.
enum Source { case noGroup, empty, snap(Snapshot) }

func loadSource() -> Source {
  guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil,
        let defaults = UserDefaults(suiteName: appGroup) else { return .noGroup }
  guard let json = defaults.string(forKey: "snapshot"), let data = json.data(using: .utf8),
        let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return .empty }
  return .snap(snap)
}

func parseISO(_ s: String) -> Date? {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
}

/// What may show at `now`: older than a day says "Tap to refresh", older than 3 days "Open to update"; app lock = a word, no ₹.
struct Shown { let big: String, unit: String, line: String, muted: Bool, wordy: Bool, pay: Bool, updated: String }

func shown(_ s: Snapshot, at now: Date) -> Shown {
  let at = parseISO(s.updated) ?? now
  let age = now.timeIntervalSince(at)
  let fresh = age > 3 * 86_400 ? 2 : age > 86_400 ? 1 : 0
  let locked = s.locked ?? false
  let big = fresh == 2 ? (s.strings?.openToUpdate ?? "") : (locked ? (s.status ?? s.big) : s.big)
  let hindi = s.lang == "hi"
  let f = DateFormatter()
  f.locale = Locale(identifier: hindi ? "hi_IN" : "en_IN")
  f.dateFormat = Calendar.current.isDate(at, inSameDayAs: now) ? "h:mm a" : "d MMM"
  let template = s.strings?.updated ?? "updated {when}"
  return Shown(
    big: big,
    unit: fresh == 2 || locked ? "" : s.unit,
    line: fresh != 0 ? (s.strings?.tapRefresh ?? "") : (locked ? "" : s.line),
    muted: fresh != 0,
    wordy: big.rangeOfCharacter(from: .decimalDigits) == nil,
    pay: (s.pay ?? false) && fresh == 0, // an old "Pay" invites paying twice
    updated: template.replacingOccurrences(of: "{when}", with: f.string(from: at)))
}

/// Fallback copy has no snapshot to take strings from: the phone's language decides.
func fallback(_ src: Source) -> String {
  let hindi = Locale.current.language.languageCode?.identifier == "hi"
  if case .noGroup = src { return hindi ? "इस इंस्टॉल पर विजेट बिजली साथी से नहीं जुड़ पा रहा" : "Widget can't connect to Bijli Saathi on this install" }
  return hindi ? "साइन इन के लिए बिजली साथी खोलें" : "Open Bijli Saathi to sign in"
}

// MARK: Timeline: redraw at midnight ("updated 4:12 pm" must not read as today tomorrow) and when it turns stale / old.

struct Entry: TimelineEntry { let date: Date; let source: Source }

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: .now, source: .empty) }
  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now, source: loadSource())) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    let src = loadSource(), now = Date.now
    var dates = [now]
    if case .snap(let s) = src, let at = parseISO(s.updated) {
      let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
      dates += [midnight, at.addingTimeInterval(86_400 + 60), at.addingTimeInterval(3 * 86_400 + 60)].filter { $0 > now }
    }
    completion(Timeline(entries: dates.sorted().map { Entry(date: $0, source: src) }, policy: .never))
  }
}

// MARK: Views

struct Palette {
  let text, muted, ok, warn, critical, big, glow, bg, button, onButton, soft, onSoft: Color
  static func of(_ scheme: ColorScheme) -> Palette {
    scheme == .dark
      ? Palette(text: hex(0xE7E7F3), muted: hex(0xA2A4BD), ok: hex(0x7FD1A0), warn: hex(0xF29A5E), critical: hex(0xF4A59C), big: hex(0xFFE3B0),
                glow: hex(0x3A2F1E), bg: hex(0x181A2E), button: hex(0xFFE3B0), onButton: hex(0x1B1C2E), soft: hex(0x2A2D48), onSoft: hex(0xE7E7F3))
      : Palette(text: hex(0x1B1C2E), muted: hex(0x585A73), ok: hex(0x2E7550), warn: hex(0xA04A14), critical: hex(0xB3261E), big: hex(0x1B1C2E),
                glow: hex(0xFBE8C6), bg: hex(0xF3F3F8), button: hex(0x3B47A8), onButton: hex(0xFFFFFF), soft: hex(0xE3E4F4), onSoft: hex(0x2B3380))
  }
  func tone(_ t: String) -> Color { t == "critical" ? critical : t == "warn" ? warn : text }
}

func hex(_ v: UInt32) -> Color {
  Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
}

/// Tone without colour (tinted / StandBy / Lock Screen drop it): a symbol for warn and critical.
func toneSymbol(_ t: String) -> String? { t == "critical" ? "exclamationmark.triangle.fill" : t == "warn" ? "clock" : nil }

struct Answer: View {
  let s: Snapshot, x: Shown, c: Palette
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(s.label).font(.system(size: 13)).foregroundStyle(c.muted).lineLimit(1)
      Spacer(minLength: 4)
      HStack(alignment: .lastTextBaseline, spacing: 4) {
        Text(x.big)
          .font(.system(size: x.wordy ? 22 : 40, weight: x.wordy ? .bold : .heavy))
          .foregroundStyle(x.muted ? c.muted : s.tone == "critical" ? c.critical : c.big)
          .lineLimit(x.wordy ? 2 : 1).minimumScaleFactor(0.5).widgetAccentable()
        if !x.unit.isEmpty { Text(x.unit).font(.system(size: 15, weight: .bold)).foregroundStyle(c.muted) }
      }
      Spacer(minLength: 4)
      if !x.line.isEmpty {
        HStack(spacing: 4) {
          if !x.muted, let sym = toneSymbol(s.tone) { Image(systemName: sym).font(.system(size: 11, weight: .bold)).widgetAccentable() }
          Text(x.line).lineLimit(1)
        }
        .font(.system(size: 13, weight: s.tone == "critical" && !x.muted ? .heavy : .bold))
        .foregroundStyle(x.muted || s.tone == "ok" ? c.text : c.tone(s.tone))
      }
      Text(x.updated).font(.system(size: 11)).foregroundStyle(c.muted).lineLimit(1)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

struct Button44: View {
  let label: String, a11y: String, url: String, primary: Bool, c: Palette
  var body: some View {
    Link(destination: URL(string: url)!) {
      Text(label).font(.system(size: 15, weight: .bold)).lineLimit(1).minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, minHeight: 48)
        .background(RoundedRectangle(cornerRadius: 14).fill(primary ? c.button : c.soft))
        .foregroundStyle(primary ? c.onButton : c.onSoft)
    }
    .accessibilityLabel(a11y)
  }
}

struct MeterView: View {
  let entry: Entry
  @Environment(\.widgetFamily) var family
  @Environment(\.colorScheme) var scheme

  var body: some View {
    let c = Palette.of(scheme)
    Group {
      switch (family, entry.source) {
      case (.accessoryInline, .snap(let s)):
        // ~20 characters, system font, one symbol: the short answer, no ₹.
        Label(s.short ?? s.status ?? s.label, systemImage: toneSymbol(s.tone) ?? "bolt.fill")
      case (.accessoryInline, _):
        Label(fallback(entry.source), systemImage: "bolt.fill")
      case (.accessoryRectangular, .snap(let s)):
        let x = shown(s, at: entry.date)
        VStack(alignment: .leading, spacing: 1) {
          Label("Bijli Saathi", systemImage: "bolt.fill").font(.caption2).foregroundStyle(.secondary)
          HStack(spacing: 4) {
            if !x.muted, let sym = toneSymbol(s.tone) { Image(systemName: sym) }
            Text(x.muted ? x.big : (s.short ?? s.status ?? "")).lineLimit(1).minimumScaleFactor(0.7)
          }
          .font(.headline).widgetAccentable()
          Text(x.updated).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      case (.accessoryRectangular, _):
        Text(fallback(entry.source)).font(.caption).lineLimit(3)
      case (.systemMedium, .snap(let s)):
        let x = shown(s, at: entry.date)
        HStack(spacing: 12) {
          Answer(s: s, x: x, c: c)
          VStack(spacing: 8) {
            if x.pay, let st = s.strings { Button44(label: st.pay, a11y: st.a11yPay, url: "uppclpro://quick/pay", primary: true, c: c) }
            Button44(label: s.strings?.noPower ?? "No power", a11y: s.strings?.a11yNoPower ?? "Report no power",
                     url: "uppclpro://quick/sms", primary: !x.pay, c: c)
          }
          .frame(width: 128)
        }
      case (_, .snap(let s)):
        Answer(s: s, x: shown(s, at: entry.date), c: c)
      default:
        VStack(alignment: .leading, spacing: 6) {
          Label("Bijli Saathi", systemImage: "bolt.fill").font(.system(size: 13, weight: .bold)).foregroundStyle(c.muted)
          Text(fallback(entry.source)).font(.system(size: 15, weight: .bold)).foregroundStyle(c.text).lineLimit(4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    }
    .widgetURL(URL(string: "uppclpro://"))
    .containerBackground(for: .widget) {
      LinearGradient(colors: [c.glow, c.bg], startPoint: .topTrailing, endPoint: .bottomLeading)
    }
  }
}

@main
struct BijliWidgets: WidgetBundle {
  var body: some Widget { MeterWidget() }
}

struct MeterWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Meter", provider: Provider()) { MeterView(entry: $0) }
      .configurationDisplayName("Bijli Saathi")
      .description("Bill due, balance days or this month's cost, at a glance.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
      .containerBackgroundRemovable(true)
  }
}
