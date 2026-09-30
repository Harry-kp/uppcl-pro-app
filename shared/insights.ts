/**
 * What the home screen tells the user, derived from raw UPPCL data.
 * Pure functions shared by the web dashboard (src/app/page.tsx) and the mobile
 * app, so both always show the same days-left, recharge advice and projections.
 */
import type { DashboardResponse, DailyBill, Payment, ConsumptionRow, MonthlyInvoice } from "./api";
import { mean, stddev, toNum } from "./stats";
import { daysBetween, billedMonthKwh, billingPeriod, FALLBACK_RATE } from "./utils";

/** Days of balance a recharge should buy. */
export const TARGET_RUNWAY_DAYS = 40;

const byBillDate = (a: DailyBill, b: DailyBill) => new Date(a.billDate).getTime() - new Date(b.billDate).getTime();

function powerFactorSeries(monthly: ConsumptionRow[]) {
  return monthly
    .map((r) => ({ t: r.powerFactor?.measureTime, v: toNum(r.powerFactor?.value) }))
    .filter((p) => p.v > 0 && p.v <= 1.5)
    .sort((a, b) => (a.t ?? "").localeCompare(b.t ?? ""));
}

export function derivePrepaid(
  data: DashboardResponse,
  bills90?: DailyBill[],
  payments?: Payment[],
  yearly?: ConsumptionRow[],
  now: number = Date.now(),
) {
  const billsAsc = [...data.recent_bills].sort(byBillDate);
  const longBills = bills90 ? [...bills90].sort(byBillDate) : billsAsc;

  const units = billsAsc.map((b) => toNum(b.dailyBill.units_billed_daily));
  const labels = billsAsc.map((b) => {
    const d = b.dailyBill.usage_date ?? b.billDate;
    return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  });

  const charges90 = longBills.map((b) => toNum(b.dailyBill.daily_chg)).filter((x) => x > 0);
  const avg30 = mean(charges90.slice(-30));
  const sd30 = stddev(charges90.slice(-30));
  const latestCharge = charges90[charges90.length - 1] ?? 0;

  const zThreshold = 1.5;
  const spike = sd30 > 0 ? (latestCharge - avg30) / sd30 : 0;
  const anomaly = spike >= zThreshold;
  const anomalyPct = avg30 > 0 ? Math.round(((latestCharge - avg30) / avg30) * 100) : 0;

  const todayKwh = units[units.length - 1] ?? 0;
  const yestKwh = units[units.length - 2] ?? 0;
  const dayDeltaPct = yestKwh > 0 ? Math.round(((todayKwh - yestKwh) / yestKwh) * 100) : 0;

  const lastPayment = payments?.[0] ?? data.recent_payments[0];
  const lastRechargeAmt = lastPayment ? toNum(lastPayment.amt) : data.balance.last_recharge;
  const daysSinceRecharge = lastPayment?.payment_dt ? daysBetween(lastPayment.payment_dt, new Date(now)) : null;
  const latestLifespan = data.recharge_lifespans[data.recharge_lifespans.length - 1];

  const pfSeries = powerFactorSeries(yearly ?? []);
  const pfLatest = pfSeries[pfSeries.length - 1]?.v ?? null;
  const pfPrev = pfSeries[pfSeries.length - 2]?.v ?? null;
  const pfDelta = pfLatest !== null && pfPrev !== null ? pfLatest - pfPrev : null;

  const next = avg30 * 30;
  const nextMargin = sd30 * Math.sqrt(30);
  const nextLow = Math.max(0, next - nextMargin);
  const nextHigh = next + nextMargin;

  const targetRunway = TARGET_RUNWAY_DAYS;
  const recommendedRaw = targetRunway * data.runway.avg_daily_spend - data.balance.inr;
  const recommendedAmount = Math.max(500, Math.ceil(recommendedRaw / 500) * 500);
  const emptyEta = data.runway.days ? new Date(now + data.runway.days * 86400_000) : null;

  return {
    units, labels, latestCharge, avg30, sd30, spike, anomaly, anomalyPct,
    todayKwh, yestKwh, dayDeltaPct, lastPayment, lastRechargeAmt, daysSinceRecharge,
    latestLifespan, pfLatest, pfDelta, next, nextLow, nextHigh, recommendedAmount,
    emptyEta, targetRunway,
  };
}



/**
 * A month's kWh from daily readings, for when UPPCL's monthly rollup isn't in yet. Daily readings lag a day or
 * two, so the days we have are scaled to the whole month rather than silently dropping the last ones. 0 if none.
 */
export function monthFromDaily(daily: ConsumptionRow[], monthStart: Date): number {
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const len = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const rows = daily.filter((r) => { const d = new Date(r.energyImportKWH?.measureTime ?? ""); return d >= monthStart && d < end; });
  if (!rows.length) return 0;
  return (rows.reduce((a, r) => a + toNum(r.energyImportKWH?.value), 0) * len) / Math.min(rows.length, len);
}export function derivePostpaid(
  data: DashboardResponse,
  opts: { outstandingAmount?: string; inv?: MonthlyInvoice; yearly?: ConsumptionRow[] },
  now: number = Date.now(),
) {
  const { inv } = opts;
  const today = new Date(now);

  // Daily kWh series from eventsummary (works for postpaid — the "daily quota" stand-in).
  const dailyRows = [...(data.consumption_30d.daily ?? [])].sort(
    (a, b) => (a.energyImportKWH?.measureTime ?? "").localeCompare(b.energyImportKWH?.measureTime ?? "")
  );
  const series = dailyRows.map((r) => toNum(r.energyImportKWH?.value));
  const labels = dailyRows.map((r) =>
    new Date(r.energyImportKWH?.measureTime ?? "").toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  );
  const avgDailyKwh = data.consumption_30d.avg_daily_kwh;

  const outstandingAmt = toNum(opts.outstandingAmount);
  const hasDues = outstandingAmt > 1;

  // Billing cycle from the latest invoice.
  const billDt = inv?.bill_dt ? new Date(inv.bill_dt) : null;
  const dueDt = inv?.due_dt ? new Date(inv.due_dt) : null;
  const daysToDue = dueDt ? daysBetween(today, dueDt) : null;
  // The unbilled cycle is the current calendar month (a bill covers the previous month — see billingPeriod).
  const cycleStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const cycleLen = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const cycleProgress = Math.min(today.getDate() / cycleLen, 1);

  // kWh consumed this cycle (since the 1st of the month).
  const cycleKwh = dailyRows
    .filter((r) => new Date(r.energyImportKWH?.measureTime ?? "") >= cycleStart)
    .reduce((s, r) => s + toNum(r.energyImportKWH?.value), 0);

  // Effective ₹/kWh: last bill amount ÷ that month's kWh (from yearly monthly rollups).
  const lastBillAmt = Math.abs(toNum(inv?.bill_amt));
  const monthlyRows = opts.yearly ?? [];
  const billMonthKwh = billDt ? billedMonthKwh(monthlyRows, billDt) : 0;
  const rateFrom: "bill" | "recent" | "typical" = billMonthKwh > 0 && lastBillAmt > 0 ? "bill"
    : data.consumption_30d.effective_rate ? "recent" : "typical"; // the copy must say which, never claim "your last bill"
  const effectiveRate = rateFrom === "bill" ? lastBillAmt / billMonthKwh
    : rateFrom === "recent" ? data.consumption_30d.effective_rate! : FALLBACK_RATE;

  // Last month has ended but its bill isn't out yet (UPPCL bills in the first days of the month):
  // until it arrives, that bill — not the new month's ₹0 — is what the user is waiting for.
  const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastBilledFrom = billDt ? billingPeriod(billDt).from : null;
  let pendingBill: { month: Date; kwh: number; amount: number; vsLast: number } | null = null;
  // No invoice (UPPCL's bill history is down): early in the month, last month's bill is still the likely one to come.
  // ponytail: day ≤ 20 is a heuristic (bills land in the first ~10 days); a real invoice always wins.
  const lastMonthUnbilled = lastBilledFrom ? lastBilledFrom < prevStart : today.getDate() <= 20;
  if (!hasDues && lastMonthUnbilled) {
    const kwh = billedMonthKwh(monthlyRows, cycleStart) || monthFromDaily(dailyRows, prevStart); // monthly rollup, else daily readings
    if (kwh > 0) {
      const amount = kwh * effectiveRate;
      pendingBill = { month: prevStart, kwh, amount, vsLast: lastBillAmt > 0 ? Math.round(((amount - lastBillAmt) / lastBillAmt) * 100) : 0 };
    }
  }

  const projectedKwh = avgDailyKwh * cycleLen;
  const projectedBill = projectedKwh * effectiveRate;
  const projVsLast = lastBillAmt > 0 ? Math.round(((projectedBill - lastBillAmt) / lastBillAmt) * 100) : 0;

  const pfSeries = powerFactorSeries(monthlyRows);
  const pfLatest = pfSeries[pfSeries.length - 1]?.v ?? null;

  // Peak demand vs sanctioned load: the highest daily peak (eventsummary `power`, kW) of the last 30 days.
  // (UPPCL's consumptionAggregation, which used to feed this, always answers empty.)
  const peakKw = Math.max(0, ...dailyRows.map((r) => toNum(r.power?.value)));
  const sanctioned = toNum(data.site.sanctionedLoad);
  const demandPct = sanctioned > 0 && peakKw > 0 ? Math.round((peakKw / sanctioned) * 100) : null;

  // Paid = a payment date exists (payment_amt may differ slightly via rounding).
  const billPaid = inv ? Boolean((inv.payment_dt || "").trim()) : false;

  return {
    series, labels, avgDailyKwh, outstandingAmt, hasDues, daysToDue, cycleProgress,
    cycleKwh, effectiveRate, rateFrom, projectedKwh, projectedBill, projVsLast, pfLatest,
    peakKw, sanctioned, demandPct, lastBillAmt, billPaid, pendingBill,
  };
}

/**
 * Bill-relief scheme the official bill portal flags on the consumer record.
 * UPPCL smuggles it into `currentAddress` as "...$True ... Eligible For <Scheme>, ...".
 */
export function schemeFromAddress(address: string | undefined): string | null {
  const m = (address ?? "").match(/\$(True|False)[^,]*?[Ee]ligible [Ff]or ([^,]+)/);
  return m && m[1].toLowerCase() === "true" ? m[2].trim() : null;
}

/** 15-minute (or hourly) readings → units per hour of the day, local time. 24 zeros when there's nothing. */
export function hourlyUnits(rows: ConsumptionRow[]): number[] {
  const out = Array<number>(24).fill(0);
  for (const r of rows) {
    const t = new Date(String(r.energyImportKWH?.measureTime ?? ""));
    const v = toNum(r.energyImportKWH?.value);
    if (!Number.isNaN(t.getTime()) && Number.isFinite(v)) out[t.getHours()] += v;
  }
  return out;
}

/** The `width`-hour stretch that used the most power, and its share of the day (0–100). */
export function busiestHours(hours: number[], width = 3): { start: number; share: number } | null {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let best = 0, start = 0;
  for (let h = 0; h <= 24 - width; h++) {
    const sum = hours.slice(h, h + width).reduce((a, b) => a + b, 0);
    if (sum > best) { best = sum; start = h; }
  }
  return { start, share: Math.round((best / total) * 100) };
}
