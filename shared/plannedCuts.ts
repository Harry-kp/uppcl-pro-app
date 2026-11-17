// PVVNL "Scheduled Supply Outage Information" PDF (Excel 2016 export) -> rows. Hermes-safe: Uint8Array + strings only.
import { inflate } from "./inflate";

export const COLS = ["sl", "zone", "circle", "division", "substation", "feeder", "meter", "type", "date", "from", "to", "hours", "reason", "area"] as const;
export type Cut = Record<(typeof COLS)[number], string> & { hindi: string[] }; // hindi: columns whose text is legacy Kruti Dev
type Item = { x: number; y: number; s: string; font: string };
type Line = { x0: number; x1: number; y0: number; y1: number };

const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };

/** object number -> its body (last definition wins, like an incremental update would). */
function objects(pdf: string) {
  const m = new Map<number, number>();
  for (const o of pdf.matchAll(/(?:^|[\r\n])(\d+) 0 obj\b/g)) m.set(+o[1], o.index! + o[0].length);
  return m;
}
function stream(pdf: string, bytes: Uint8Array, at: number): string {
  const end = pdf.indexOf("stream", at), dict = pdf.slice(at, end);
  const len = +(/\/Length (\d+)(?! \d+ R)/.exec(dict)?.[1] ?? NaN);
  let s = end + 6; if (pdf[s] === "\r") s++; if (pdf[s] === "\n") s++;
  const raw = bytes.subarray(s, Number.isFinite(len) ? s + len : pdf.indexOf("endstream", s));
  if (/\/Filter\s*\/FlateDecode/.test(dict)) return latin1(inflate(raw));
  if (/\/Filter/.test(dict)) throw new Error("unsupported filter");
  return latin1(raw);
}
const unescape = (s: string) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) =>
  /[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[c] ?? c);

/** Text (absolute Tm positions, as Excel writes them) and cell borders (thin filled rects). */
function scan(content: string) {
  const items: Item[] = [], h: Line[] = [], v: Line[] = [];
  let font = "";
  for (const m of content.matchAll(/BT([\s\S]*?)ET|(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\s+f\*?/g)) {
    if (m[1] === undefined) {
      const [x, y, w, hh] = [m[2], m[3], m[4], m[5]].map(Number);
      if (hh < 1 && w > 1) h.push({ x0: x, x1: x + w, y0: y, y1: y });
      else if (w < 1 && hh > 1) v.push({ x0: x, x1: x, y0: y, y1: y + hh });
      continue;
    }
    const bt = m[1];
    font = /\/(\w+) [\d.]+ Tf/.exec(bt)?.[1] ?? font;
    const tm = /(-?[\d.]+) (-?[\d.]+) Tm/.exec(bt);
    if (!tm) continue;
    let s = "";
    for (const t of bt.matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)/g)) s += unescape(t[1]);
    items.push({ x: +tm[1], y: +tm[2], s, font });
  }
  return { items, h, v };
}

const isKruti = (fonts: Record<string, string>, f: string) => /Kruti/i.test(fonts[f] ?? "");

export function parsePlannedCuts(bytes: Uint8Array): { cuts: Cut[]; nil: string[]; problems: string[] } {
  const pdf = latin1(bytes), objs = objects(pdf), cuts: Cut[] = [], nil: string[] = [], problems: string[] = [];
  const body = (n: number) => { const at = objs.get(n); if (at === undefined) throw new Error(`missing obj ${n}`); return pdf.slice(at, pdf.indexOf("endobj", at)); };
  const root = +(/\/Root (\d+) 0 R/.exec(pdf)?.[1] ?? NaN);
  const pagesRef = +(/\/Pages (\d+) 0 R/.exec(body(root))?.[1] ?? NaN);
  const kids = [...(/\/Kids\s*\[([^\]]*)\]/.exec(body(pagesRef))?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((k) => +k[1]);
  let carry: Partial<Cut> = {};
  kids.forEach((pageNo, pi) => {
    try {
      const page = body(pageNo);
      const fonts: Record<string, string> = {};
      for (const f of page.matchAll(/\/(F\d+) (\d+) 0 R/g)) fonts[f[1]] = /\/BaseFont\s*\/(\S+?)[/>\s]/.exec(body(+f[2]))?.[1] ?? "";
      const contents = /\/Contents\s*(?:\[([^\]]*)\]|(\d+) 0 R)/.exec(page);
      const refs = contents ? [...(contents[1] ?? `${contents[2]} 0 R`).matchAll(/(\d+) 0 R/g)].map((r) => +r[1]) : [];
      const { items, h, v } = scan(refs.map((r) => stream(pdf, bytes, objs.get(r)!)).join("\n"));
      // Column edges = x of the full-height vertical borders.
      const xs = [...new Set(v.map((l) => Math.round(l.x0)))].sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 2);
      if (xs.length !== COLS.length + 1) { problems.push(`page ${pi + 1}: ${xs.length - 1} columns, expected ${COLS.length}`); return; }
      const col = (x: number) => xs.findIndex((e, i) => i < xs.length - 1 && x >= e - 1 && x < xs[i + 1]);
      // Horizontal borders per column (a merged cell has none inside it).
      const borders = (c: number) => {
        const cx = (xs[c] + xs[c + 1]) / 2;
        return [...new Set(h.filter((l) => l.x0 <= cx && l.x1 >= cx).map((l) => +l.y0.toFixed(1)))].sort((a, b) => b - a);
      };
      const cols = COLS.map((_, c) => ({ ys: borders(c), items: items.filter((it) => col(it.x) === c) }));
      const rowsOf = (c: number) => cols[c].ys;
      const cellText = (c: number, y: number) => {
        const ys = rowsOf(c), top = ys.find((b, i) => b > y && (ys[i + 1] ?? -1) < y)!, bot = ys.find((b) => b < y) ?? 0;
        const inCell = cols[c].items.filter((it) => it.y < (top ?? 1e9) && it.y > bot).sort((a, b) => b.y - a.y || a.x - b.x);
        return { text: inCell.map((it) => it.s).join(" ").replace(/\s+/g, " ").trim(), hindi: inCell.some((it) => isKruti(fonts, it.font)) };
      };
      const header = items.find((it) => it.s.trim() === "ZONE");
      const headerY = header ? (rowsOf(1).find((b) => b < header.y) ?? 0) : 1e9;
      // A row = one band of the feeder-meter column (finest-grained column, one meter per feeder).
      const bands = rowsOf(COLS.indexOf("meter")).filter((y) => y <= headerY);
      for (let i = 0; i < bands.length - 1; i++) {
        const mid = (bands[i] + bands[i + 1]) / 2, row = {} as Cut;
        row.hindi = [];
        COLS.forEach((name, c) => { const t = cellText(c, mid); row[name] = t.text; if (t.hindi) row.hindi.push(name); });
        if (COLS.slice(4).map((k) => row[k]).some((v) => /^NIL$/i.test(v))) { nil.push(row.zone); continue; } // zone has no cuts
        if (!row.feeder && !row.meter && !row.date) continue; // spacer band
        for (const k of ["zone", "circle", "division", "substation"] as const) row[k] ||= carry[k] ?? ""; // merged cell split across a page break
        carry = row;
        if (!/^\d{1,2}[-./]\d{1,2}[-./]\d{4}$/.test(row.date) || !/\d{1,2}:\d{2}/.test(row.from) || !row.substation)
          problems.push(`page ${pi + 1}: incomplete row ${JSON.stringify([row.substation, row.feeder, row.date, row.from, row.to])}`);
        cuts.push(row);
      }
    } catch (e) { problems.push(`page ${pi + 1}: ${(e as Error).message}`); }
  });
  return { cuts, nil, problems };
}

// Fuzzy substation/feeder name matching for Hinglish spellings ("Pallavpuram Ph-2" ~ "PALLAVPURAM PHASE-II").
const ROMAN: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6" };
export function norm(s: string): { key: string; nums: string } {
  const words = s.toUpperCase()
    .replace(/\b(\d+\/\d+\s*KV|\d+\s*KV|S\/S|SUB-?\s*STATION|SUBSTATION|UPKENDRA|FEEDER|NEW)\b/g, " ") // noise words
    .replace(/[^A-Z0-9]+/g, " ").trim().split(" ")
    .map((w) => ROMAN[w] ?? w.replace(/(?<=...)S$/, "")) // LINES~LINE
    .filter((w) => !/^(PH|PHASE|NO|SEC|SECTOR)$/.test(w)); // "PH-2"/"PHASE II"/"SECTOR 13" -> just the number
  const nums = words.filter((w) => /^\d+$/.test(w)).join(" ");
  const key = words.filter((w) => !/^\d+$/.test(w)).join("")
    .replace(/(.)\1+/g, "$1")                    // ALLAH~ALAH, SHUKRTAAL~SHUKRTAL
    .replace(/AA/g, "A").replace(/EE/g, "I").replace(/OO/g, "U").replace(/W/g, "V").replace(/Z/g, "J")
    .replace(/(?<=[^AEIOU])[AEIOU](?=[^AEIOU])/g, ""); // drop inner short vowels: KANKER~KANKAR, SHUKARTAL~SHUKRTAL
  return { key, nums };
}
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); grams.set(g, (grams.get(g) ?? 0) + 1); }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) { const g = b.slice(i, i + 2), c = grams.get(g) ?? 0; if (c) { hit++; grams.set(g, c - 1); } }
  return (2 * hit) / (a.length + b.length - 2);
}
/** 0..1. Numbers must agree exactly (Phase-I is not Phase-II); a side with no number is a weaker match. */
export function nameScore(mine: string, theirs: string): number {
  const a = norm(mine), b = norm(theirs);
  if (a.nums && b.nums && a.nums !== b.nums) return 0;
  const s = dice(a.key, b.key);
  return a.nums === b.nums ? s : s * 0.9;
}
export const SAME_NAME = 0.8; // ponytail: one threshold, tuned on one day's list; revisit with a few weeks of real names

// ─── The list, slimmed, and the user's own cuts ───────────────────────────────

/** One planned cut as the app keeps it (no meter numbers; legacy Kruti Dev text dropped: it reads as gibberish). */
export interface PlannedCut {
  substation: string; feeder: string | null; place: string; // place = zone · circle · division
  date: string; from: string; to: string; reason: string | null; area: string | null;
}
export interface PlannedList { url: string; cuts: PlannedCut[] }

export function slim(c: Cut): PlannedCut {
  const en = (k: "reason" | "area") => (c.hindi.includes(k) || !c[k] ? null : c[k]);
  return { substation: c.substation, feeder: c.feeder || null, place: [c.zone, c.circle, c.division].join(" "),
    date: c.date, from: c.from, to: c.to, reason: en("reason"), area: en("area") };
}

/** "17-11-2026" + "13:00 & 17:00" / "15:00 & 19:00" → one [start, end] per window, local time. */
export function windowsOf(c: Pick<PlannedCut, "date" | "from" | "to">): { start: Date; end: Date }[] {
  const d = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(c.date.trim());
  if (!d) return [];
  const at = (t: string) => { const [h, m] = t.split(/[:.]/).map(Number); return new Date(+d[3], +d[2] - 1, +d[1], h, m); };
  const froms = c.from.match(/\d{1,2}[:.]\d{2}/g) ?? [], tos = c.to.match(/\d{1,2}[:.]\d{2}/g) ?? [];
  return froms.flatMap((f, i) => (tos[i] ? [{ start: at(f), end: at(tos[i]) }] : [])).filter((w) => w.end > w.start);
}

export interface MyCut extends PlannedCut { start: Date; end: Date }

/** The user's cuts that haven't ended and start before the day after tomorrow, soonest first.
 *  `city` (from the 1912 sub-division, e.g. "Meerut") keeps a same-name substation in another district out. */
export function myPlannedCuts(list: PlannedList | null | undefined, mine: { substation: string; city?: string | null }, now = new Date()): MyCut[] {
  if (!list) return [];
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  const city = mine.city?.toUpperCase().replace(/[^A-Z]/g, "");
  return list.cuts
    .filter((c) => nameScore(mine.substation, c.substation) >= SAME_NAME && (!city || c.place.toUpperCase().replace(/[^A-Z]/g, "").includes(city)))
    .flatMap((c) => windowsOf(c).map((w) => ({ ...c, ...w })))
    .filter((c) => c.end > now && c.start < horizon)
    .sort((a, b) => +a.start - +b.start);
}

/** "EUDSD-13 Meerut" → "Meerut". */
export const cityOf = (subdivision: string | null | undefined) => /([A-Za-z]{3,})\s*$/.exec(subdivision ?? "")?.[1] ?? null;
