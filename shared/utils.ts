export function rupees(n: number | string | null | undefined, opts: { decimals?: number; sign?: boolean } = {}) {
  const { decimals = 2, sign = false } = opts;
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return "—";
  const s = v.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return sign && v > 0 ? `+${s}` : s;
}

export function kwh(n: number | string | null | undefined, decimals = 2) {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/**
 * UPPCL smart-meter billing period for a given bill date.
 * Rule (from the official bill): the cycle is the FIRST→LAST day of the
 * *previous* calendar month — i.e. the bill dated early June covers May.
 * `bill_dt`/`bill_from_dt` from the API is the generation date, NOT the period.
 */
export function billingPeriod(billDt: string | Date): { label: string; from: Date; to: Date } {
  const d = typeof billDt === "string" ? new Date(billDt) : billDt;
  const to = new Date(d.getFullYear(), d.getMonth(), 1);        // 1st of the bill month
  const from = new Date(d.getFullYear(), d.getMonth() - 1, 1);  // 1st of the previous month
  const label = from.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return { label, from, to };
}

/** ₹/kWh used when no billed month can be matched (≈ UP LMV-1 151–300 slab). */
export const FALLBACK_RATE = 6.5;

type MonthlyRow = { energyImportKWH?: { measureTime?: string | number | null; value?: unknown } | null };

/** kWh of the month a bill covers — the month *before* its bill date (see billingPeriod). 0 if absent. */
export function billedMonthKwh(monthly: MonthlyRow[], billDt: string | Date): number {
  const { from } = billingPeriod(billDt);
  const row = monthly.find((r) => {
    const t = r.energyImportKWH?.measureTime;
    const d = t ? new Date(String(t)) : null;
    return d !== null && d.getFullYear() === from.getFullYear() && d.getMonth() === from.getMonth();
  });
  const v = parseFloat(String(row?.energyImportKWH?.value));
  return Number.isFinite(v) ? v : 0;
}

/** Title / subtitle / raw date from UPPCL's loosely-typed alarm, alert and ticket records. */
export function recordSummary(r: Record<string, unknown>): { title: string; subtitle?: string; date?: string } {
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  const title =
    s("title") || s("alarmType") || s("type") || s("subject") || s("message") || s("complaint_no") || "Event";
  const subtitle = s("description") || s("body") || s("status") || s("sub_type") || s("message");
  return {
    title,
    subtitle: subtitle === title ? undefined : subtitle,
    date: s("createdAt") || s("created_at") || s("date") || s("entry_date") || s("startDate"),
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * UPPCL dates come as ISO, "05-SEP-2026 10:30:00" or "05-09-2026". Browsers are lenient with
 * the last two; Hermes (React Native) isn't, so parse them explicitly. null when unparseable.
 */
export function parseUppclDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = new Date(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(iso.getTime())) return iso;
  const m = s.trim().match(/^(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})[-/ ](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?)?/);
  if (!m) return Number.isNaN(iso.getTime()) ? null : iso;
  const month = /\d/.test(m[2]) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (month < 0 || month > 11) return null;
  let hour = Number(m[4] ?? 0);
  if (m[7]) hour = (hour % 12) + (/p/i.test(m[7]) ? 12 : 0); // appsavy: "30/09/2026 10:15:00 PM"
  return new Date(Number(m[3]), month, Number(m[1]), hour, Number(m[5] ?? 0), Number(m[6] ?? 0));
}

// ─── Number helpers: strings → numbers, NaN/null safe ─────────────────────────
export function toNum(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
}

export function mean(xs: number[]): number {
  const ys = xs.filter((x) => Number.isFinite(x));
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
}

export function stddev(xs: number[]): number {
  const ys = xs.filter((x) => Number.isFinite(x));
  if (ys.length < 2) return 0;
  const m = mean(ys);
  return Math.sqrt(ys.reduce((a, x) => a + (x - m) ** 2, 0) / (ys.length - 1));
}

export function sum(xs: number[]): number {
  return xs.filter((x) => Number.isFinite(x)).reduce((a, b) => a + b, 0);
}
