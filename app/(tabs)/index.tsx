import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, StyleSheet, View, Platform, ToastAndroid } from "react-native";
import * as Clipboard from "expo-clipboard";
import { COMPLAINT_SMS_NUMBER, HELPLINE_TEL, noPowerSmsUrl } from "@shared/outage";
import { router, useFocusEffect } from "expo-router";
import {
  downloadBillPdf, useBills, useDashboard, useMe, useDowntime, useLatestInvoice, useOutstanding, usePayments, useUsageStats,
  useMyComplaints, useWssArrears, useWssConsumer, useYearlyHistory,
  type DashboardResponse, type MonthlyInvoice,
} from "@shared/api";
import { platform } from "@shared/platform";
import { derivePostpaid, derivePrepaid, schemeFromAddress, TARGET_RUNWAY_DAYS } from "@shared/insights";
import { toNum } from "@shared/stats";
import { billingPeriod, parseUppclDate, rupees, kwh } from "@shared/utils";
import { Bars } from "../../src/Bars";
import { saveSnapshot } from "../../src/widget";
import { openFor } from "@shared/complaints";
import { getBudget } from "../../src/alerts";
import { keystore, NAME_KEY, UPPCL_SMART_URL } from "../../src/boot";
import { UpdateCard } from "../../src/github";
import { ReportSheet } from "../../src/report";

import { ErrorNote } from "../../src/errors";
import { useI18n } from "../../src/i18n";
import { font, radius, useColors } from "../../src/theme";
import { Button, Card, Centered, Glow, Insight, Pill, Screen, Txt } from "../../src/ui";
import { Icon, type IconName } from "../../src/icons";
import { openLink } from "../../src/links";

/** Prepaid recharge happens on UPPCL's page, which asks for the account number: copy it first and say so. */
async function openPay(accountNo: string, copiedMessage: string): Promise<void> {
  await Clipboard.setStringAsync(accountNo).catch(() => {});
  if (Platform.OS === "android") ToastAndroid.show(copiedMessage, ToastAndroid.LONG);
  openLink(UPPCL_SMART_URL);
}

export default function Home() {
  const { data, error, isLoading, mutate, isValidating } = useDashboard();
  const { t } = useI18n();
  if (error && !data) return (
    <Screen>
      {/* Nothing loaded yet, but Settings (language, sign out) must stay reachable. */}
      <View style={styles.greeting}>
        <Txt v="title" style={{ flex: 1 }}>UPPCL Pro</Txt>
        <GearButton />
      </View>
      <ErrorNote error={error} onRetry={() => mutate()} />
    </Screen>
  );
  if (isLoading || !data) return <Centered><Txt v="body" color="muted">{t("loading")}</Txt></Centered>;
  return (
    <Screen onRefresh={() => mutate()} refreshing={isValidating}>
      <Greeting data={data} />
      <UpdateCard />
      {error && <ErrorNote error={error} stale compact />}
      <PlannedCut />
      <ComplaintStatus />
      {data.site.connectionType === "postpaid" ? <Postpaid data={data} /> : <Prepaid data={data} />}
    </Screen>
  );
}

/**
 * Your 1912 complaint, only while it matters: open (how long, and whether an engineer is on it), or fixed in the
 * last 24 h. Loads after Home has drawn, from a separate host, and shares the Complaints tab's cache.
 */
function ComplaintStatus() {
  const c = useColors();
  const { t, span, ago } = useI18n();
  const { data: me } = useMe();
  const { data } = useMyComplaints(me?.data?.[0]?.phone);
  const list = data?.complaints ?? [];
  const open = list.find((x) => x.is_open);
  const fixed = !open ? list.find((x) => { const at = parseUppclDate(x.closing_date)?.getTime(); return at && Date.now() - at < 24 * 3600_000; }) : undefined;
  const x = open ?? fixed;
  if (!x) return null;
  const ms = openFor(x);
  const type = x.sub_type || x.type || t("complaint_no", { no: x.complaint_no });
  const line = open
    ? [ms !== null && t("cx_open_for", { t: span(ms) }), (x.je_mobile || x.je_name) && t("hc_engineer")].filter(Boolean).join(" · ")
    : [ms !== null && t("cx_took", { t: span(ms) }), x.closing_date && ago(parseUppclDate(x.closing_date)!)].filter(Boolean).join(" · ");
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/complaint/[no]", params: { no: x.complaint_no } })}
      style={({ pressed }) => [styles.complaint, { backgroundColor: open ? c.accentSoft : c.surface, borderColor: c.line, opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.complaintIcon, { backgroundColor: c.pill }]}>
        <Icon name={open ? "supportAgent" : "checkCircle"} size={20} color={open ? c.pillText : c.ok} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="body" weight="semibold" numberOfLines={2}>{t(open ? "hc_open" : "hc_fixed", { type })}</Txt>
        {!!line && <Txt v="caption" color="muted" numberOfLines={1}>{line}</Txt>}
      </View>
      <Icon name="chevronRight" size={20} color={c.muted} />
    </Pressable>
  );
}

/** UPPCL's own maintenance / planned-outage notice for the discom, when there is one. */
function PlannedCut() {
  const { t } = useI18n();
  const { data } = useDowntime();
  const notice = data?.data?.body || data?.data?.title;
  if (!notice) return null;
  return <Insight tone="warn" icon="event" text={`${t("planned_cut")}: ${String(notice).trim()}`} />;
}

/** Trust: one tap shows how the number on the card was worked out (web: "How this is computed"). */
function HowLink({ text }: { text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.how}>
        <Icon name="info" size={16} color={useColors().primary} />
        <Txt v="label" color="primary" weight="semibold">{t("how_calc")}</Txt>
      </Pressable>
      {open && <Txt v="caption" color="muted">{text}</Txt>}
    </View>
  );
}

/** A figure tile with a small leading icon so it can be found by shape. */
function Tile({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  const c = useColors();
  return (
    <Card style={styles.mini}>
      <View style={styles.tileHead}>
        <Icon name={icon} size={14} color={c.muted} />
        <Txt v="caption" color="muted" style={{ flex: 1 }} numberOfLines={1}>{label}</Txt>
      </View>
      {children}
    </Card>
  );
}

function useDateFmt() {
  const { locale } = useI18n();
  return (d: Date | string, withYear = false) =>
    new Date(d).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

function GearButton() {
  const c = useColors();
  const { t } = useI18n();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("settings_title")} onPress={() => router.push("/settings")}
      hitSlop={8} style={({ pressed }) => [styles.gear, { backgroundColor: c.pill, opacity: pressed ? 0.8 : 1 }]}>
      <Icon name="settings" size={22} color={c.pillText} />
    </Pressable>
  );
}

function Greeting({ data }: { data: DashboardResponse }) {
  const c = useColors();
  const { t, ago: i18nAgo, locale } = useI18n();
  const h = new Date().getHours();
  // The account holder's first name when UPPCL has one; otherwise a time-of-day greeting.
  const { data: me } = useMe();
  const { data: consumer } = useWssConsumer();
  // UPPCL SMART often stores "NA"; fall back to the name on the connection's official record.
  const real = (n?: string | null) => { const w = String(n ?? "").trim().split(/\s+/)[0]; return /^[\p{L}]{2,}$/u.test(w) && !/^(na|null|none|test)$/i.test(w) ? w : ""; };
  const found = real(me?.data?.[0]?.name) || real(consumer?.ConsumerDetails?.name) || real(data.site.customerName);
  // Remember the last real name, so a UPPCL outage later doesn't bring the greeting back.
  let testData = false; // true while a dev test scenario feeds fake data: never remember that name
  testData = platform.mock?.("scenario:active") === true; // @dev-tools seam
  useEffect(() => { if (found && !testData) keystore.setItem(NAME_KEY, found); }, [found, testData]);
  const first = found || (testData ? "" : real(keystore.getItem(NAME_KEY)));
  const greet = first ? first.charAt(0).toUpperCase() + first.slice(1) : t(h >= 5 && h < 12 ? "greeting_morning" : h >= 12 && h < 17 ? "greeting_afternoon" : "greeting_evening");
  // Prepaid has a live balance timestamp; postpaid only has daily readings, so use the latest one.
  const latestReading = data.consumption_30d.daily
    .map((r) => String(r.energyImportKWH?.measureTime ?? ""))
    .filter(Boolean)
    .sort()
    .pop();
  // Prepaid: a live balance time ("updated 5 min ago"). Postpaid: the last day UPPCL has readings for — "updated 2 days
  // ago" there only reflected UPPCL's normal daily lag and read as a stale app.
  const ago = data.balance.updated_at ? i18nAgo(data.balance.updated_at) : null;
  const readingsTo = !ago && latestReading ? new Date(latestReading).toLocaleDateString(locale, { day: "numeric", month: "short" }) : null;
  const meterId = String(data.site.connectionId); // the account number, in full: not a secret, and people need it
  return (
    <View style={styles.greeting}>
      <View style={{ flex: 1 }}>
        <Txt v="title">{greet}</Txt>
        {/* Which kind of connection this is, at a glance: the whole Home changes with it. */}
        <View style={styles.metaRow}>
          <View style={[styles.kind, { backgroundColor: c.pill }]}>
            <Txt v="caption" weight="bold" color="pillText">{data.site.connectionType === "postpaid" ? t("postpaid") : t("prepaid")}</Txt>
          </View>
          <Txt v="caption" color="muted" style={{ flexShrink: 1 }}>{ago ? t("meter_line", { id: meterId, ago }) : readingsTo ? t("meter_readings_to", { id: meterId, date: readingsTo }) : t("meter_only", { id: meterId })}</Txt>
        </View>
      </View>
      <GearButton />
    </View>
  );
}

/**
 * Shortcuts that *do* a job from Home (open the bill PDF, open the ready no-power SMS). Anything that
 * only navigates belongs to the tab bar, never here — no duplicates of a tab (user feedback).
 */
function QuickActions({ data, onBill, billBusy, hasDues }: { data: DashboardResponse; onBill?: () => void; billBusy?: boolean; hasDues?: boolean }) {
  const { t } = useI18n();
  const [report, setReport] = useState(false); // "No power?" asks what's wrong first (src/report.tsx)
  return (
    <View style={styles.actions}>
      <ReportSheet data={data} visible={report} onClose={() => setReport(false)} />
      {/* Prepaid has no bill PDF, so its tiles are the two ways to report a cut. */}
      {onBill && <Action icon="receiptLong" label={billBusy ? t("opening") : t("qa_bill")} onPress={onBill} disabled={billBusy} />}
      <Action icon="sms" label={t("qa_no_power")} onPress={() => setReport(true)} />
      {!onBill && <Action icon="call" label={t("call_1912")} onPress={() => openLink(`tel:${HELPLINE_TEL}`)} />}
      {/* When a bill is due, the hero's Pay button is the one; the tile is for paying ahead. */}
      {data.site.connectionType === "postpaid" && !hasDues && <Action icon="currencyRupee" label={t("qa_pay")} onPress={() => router.push("/pay")} />}
    </View>
  );
}

function Action({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.action, { backgroundColor: c.surface, borderColor: c.line, opacity: pressed || disabled ? 0.7 : 1 }]}>
      <View style={[styles.actionIcon, { backgroundColor: c.pill }]}><Icon name={icon} size={22} color={c.primary} /></View>
      <Txt v="label" weight="semibold" style={{ textAlign: "center" }}>{label}</Txt>
    </Pressable>
  );
}

/** Re-read the budget whenever Home regains focus (it's set in Settings). */
function useFocusBudget() {
  const [budget, setBudgetState] = useState(getBudget);
  useFocusEffect(useCallback(() => setBudgetState(getBudget()), []));
  return budget;
}

// ── Prepaid ──────────────────────────────────────────────────────────────────

function Prepaid({ data }: { data: DashboardResponse }) {
  const c = useColors();
  const { t, locale, lang } = useI18n();
  const fmt = useDateFmt();
  const { data: bills } = useBills(90);
  const { data: payments } = usePayments(50);
  const { data: yearly } = useYearlyHistory();
  const d = useMemo(() => derivePrepaid(data, bills?.data, payments?.data, yearly?.data), [data, bills, payments, yearly]);

  // 7-day window vs the 7 days before it, from the 90-day daily bills.
  const week = useMemo(() => {
    const asc = [...(bills?.data ?? data.recent_bills)].sort((a, b) => new Date(a.billDate).getTime() - new Date(b.billDate).getTime());
    const units = asc.map((b) => toNum(b.dailyBill.units_billed_daily));
    const dates = asc.map((b) => b.dailyBill.usage_date ?? b.billDate);
    const last7 = units.slice(-7), prev7 = units.slice(-14, -7);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const pct = prev7.length === 7 && sum(prev7) > 0 ? Math.round(((sum(last7) - sum(prev7)) / sum(prev7)) * 100) : null;
    return { last7, dates7: dates.slice(-7), total: sum(last7), pct, latestDate: dates[dates.length - 1] };
  }, [bills, data]);

  const days = data.runway.days;
  // Judge urgency on the whole days the user sees ("2 days"), not the raw 2.13.
  const shownDays = days === null ? null : Math.floor(days);
  const urgent = shownDays !== null && shownDays <= 2;
  useEffect(() => {
    if (days === null) return;
    saveSnapshot({
      label: t("balance_lasts"), big: String(Math.floor(days)), unit: Math.floor(days) === 1 ? t("day") : t("days"),
      line: t("balance_only", { balance: rupees(data.balance.inr, { decimals: 0 }) }),
      tone: Math.floor(days) <= 2 ? "critical" : Math.floor(days) <= 3 ? "warn" : "ok", updated: new Date().toISOString(), lang,
    });
  }, [days, data.balance.inr, lang, t]);
  const perDay = Math.round(data.runway.avg_daily_spend);
  const byDate = d.emptyEta ? new Date(d.emptyEta.getTime() - 2 * 86400_000) : null;
  // "by <date>" only when that date is still ahead; on the day itself (or later) it's "now".
  const byLater = byDate && byDate.toDateString() !== new Date().toDateString() && byDate.getTime() > Date.now();
  const rechargeLabel = byLater
    ? t("recharge_by", { amount: rupees(d.recommendedAmount, { decimals: 0 }), date: fmt(byDate!) })
    : t("recharge_now", { amount: rupees(d.recommendedAmount, { decimals: 0 }) });
  const latestCost = d.latestCharge;
  const belowUsual = d.avg30 > 0 && latestCost <= d.avg30;

  const insight = d.anomaly && week.latestDate
    ? { text: t("insight_spike", { date: fmt(week.latestDate), pct: d.anomalyPct }), tone: "accent" as const }
    : d.latestLifespan
      ? { text: t("insight_lifespan", { amount: rupees(d.latestLifespan.amount, { decimals: 0 }), days: Math.round(d.latestLifespan.lasted_days) }), tone: "accent" as const }
      : { text: t("insight_calm"), tone: "accent" as const };

  return (
    <>
      <Card style={styles.hero}>
        <Glow />
        <Txt v="label" color="muted">{t("balance_lasts")}</Txt>
        {days !== null ? (
          <View style={styles.bigRow}>
            <Txt v="hero" numeric color={urgent ? "critical" : "big"}>{Math.floor(days)}</Txt>
            <Txt v="heading" color="muted" style={{ marginBottom: 10 }}>{Math.floor(days) === 1 ? t("day") : t("days")}</Txt>
          </View>
        ) : (
          <Txt v="title" numeric>{t("balance_only", { balance: rupees(data.balance.inr, { decimals: 0 }) })}</Txt>
        )}
        {days !== null && <Txt v="label" color="muted">{t("balance_line", { balance: rupees(data.balance.inr, { decimals: 0 }), perDay })}</Txt>}
        {days !== null && (
          <View style={{ gap: 5 }}>
            <View style={[styles.track, { backgroundColor: c.track }]}>
              <View style={[styles.fill, { backgroundColor: urgent ? c.critical : c.fill, width: `${Math.min(100, (days / TARGET_RUNWAY_DAYS) * 100)}%` }]} />
            </View>
            <View style={styles.ticks}>
              <Txt v="caption" color="muted">{d.lastPayment?.payment_dt ? t("recharged_on", { date: fmt(d.lastPayment.payment_dt) }) : " "}</Txt>
              {d.emptyEta && <Txt v="caption" color="muted">{t("runs_out", { date: fmt(d.emptyEta) })}</Txt>}
            </View>
          </View>
        )}
        <Button label={rechargeLabel} onPress={() => openPay(String(data.site.connectionId), t("pay_copied"))} />
        {days !== null && <HowLink text={t("how_prepaid")} />}
      </Card>

      <QuickActions data={data} />

      {/* Same projection the web shows as "Next bill estimate": 30 × avg daily charge ± √30·σ. */}
      {d.next > 0 && (
        <Insight tone="accent" icon="calendarMonth" text={t("prepaid_month_estimate", { amount: rupees(d.next, { decimals: 0 }) })} />
      )}
      {data.subsidy_ytd_inr > 0 && <Insight tone="ok" icon="savings" text={t("subsidy", { amount: rupees(data.subsidy_ytd_inr, { decimals: 0 }) })} />}

      {week.last7.length > 0 && (
        <Card>
          <View style={styles.cardHead}>
            <Txt v="heading" style={{ flex: 1 }}>{week.latestDate ? t("chart_to", { date: new Date(week.latestDate).toLocaleDateString(locale, { day: "numeric", month: "short" }) }) : t("last_7")}</Txt>
            <Txt v="caption" color="muted">{t("units")}</Txt>
          </View>
          {week.pct !== null && (
            <View style={styles.chips}>
              <Pill tone={week.pct > 0 ? "warn" : "ok"} icon="trendingUp" flipIcon={week.pct < 0}
                label={t("vs_prev", { pct: `${week.pct > 0 ? "+" : week.pct < 0 ? "−" : ""}${Math.abs(week.pct)}%` })} />
            </View>
          )}
          <Bars
            values={week.last7}
            details={week.dates7.map((x, i) => `${fmt(x)} · ${kwh(week.last7[i], 1)} ${t("units")}`)}
            labels={week.dates7.map((x) => new Date(x).toLocaleDateString(locale, { weekday: "narrow" }))}
            summary={`${t("last_7")}: ${week.last7.map((v) => kwh(v, 1)).join(", ")} ${t("units")}`}
          />
        </Card>
      )}

      {/* A fact keeps its own tone; urgency already shows in the red number and the Recharge button. */}
      <Insight text={insight.text} tone={insight.tone} />
    </>
  );
}

// ── Postpaid ─────────────────────────────────────────────────────────────────

function Postpaid({ data }: { data: DashboardResponse }) {
  const c = useColors();
  const { t, locale, lang } = useI18n();
  const { data: outstanding, error: outstandingError } = useOutstanding();
  const { data: invoiceResp } = useLatestInvoice();
  const { data: stats } = useUsageStats();
  const { data: yearly } = useYearlyHistory();
  const { data: wssArrears } = useWssArrears();
  const { data: wssConsumer } = useWssConsumer();
  const [downloading, setDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<unknown>(null);

  const inv = (invoiceResp?.data as MonthlyInvoice | undefined)?.invoice_id ? (invoiceResp!.data as MonthlyInvoice) : undefined;
  const d = useMemo(
    () => derivePostpaid(data, { outstandingAmount: outstanding?.data?.outstandingAmount, inv, stats: stats?.data, yearly: yearly?.data }),
    [data, outstanding, inv, stats, yearly],
  );

  const overdue = d.daysToDue !== null && d.daysToDue < 0 && !d.billPaid;
  const now = new Date();
  const month = (dt: Date) => dt.toLocaleDateString(locale, { month: "long" });
  const thisMonth = month(now);
  const nextMonth = month(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  // A bill dated in month M covers M−1 (see billingPeriod), so name the bill by the month it covers.
  const billMonth = inv ? billingPeriod(inv.bill_dt).from.toLocaleDateString(locale, { month: "long" }) : null;
  const billStatus = !inv || !billMonth ? null
    : d.billPaid ? { text: t("last_bill_paid", { month: billMonth }), chip: t("month_paid", { month: billMonth }), tone: "ok" as const }
    : { text: t("last_bill_due", { month: billMonth, amount: rupees(d.lastBillAmt, { decimals: 0 }), date: new Date(inv.due_dt).toLocaleDateString(locale, { day: "numeric", month: "short" }) }), chip: t("month_unpaid", { month: billMonth }), tone: overdue ? ("critical" as const) : ("warn" as const) };

  useEffect(() => {
    saveSnapshot(d.hasDues
      ? { label: t("amount_due"), big: `₹${rupees(d.outstandingAmt, { decimals: 0 })}`, unit: "", line: billStatus?.text ?? "", tone: overdue ? "critical" : "warn", updated: new Date().toISOString(), lang }
      : d.pendingBill
        ? { label: t("bill_on_way", { month: month(d.pendingBill.month) }), big: `₹${rupees(d.pendingBill.amount, { decimals: 0 })}`, unit: "", line: t("bill_expected", { next: thisMonth }), tone: "ok", updated: new Date().toISOString(), lang }
        : { label: t("month_so_far", { month: thisMonth }), big: `₹${rupees(d.cycleKwh * d.effectiveRate, { decimals: 0 })}`, unit: "", line: billStatus?.text ?? t("not_billed", { next: nextMonth }), tone: "ok", updated: new Date().toISOString(), lang });
  }, [d.hasDues, d.outstandingAmt, d.cycleKwh, d.effectiveRate, d.pendingBill?.amount, billStatus?.text, overdue, thisMonth, nextMonth, lang, t]);

  async function download() {
    if (!inv) return;
    setDownloading(true);
    setPdfError(null);
    try { await downloadBillPdf({ invoice_id: inv.invoice_id }); }
    catch (e) { setPdfError(e); }
    finally { setDownloading(false); }
  }

  // Things that cost money or need action, as on the web dashboard — only when true.
  const arrears = toNum(wssArrears?.data?.amount);
  const scheme = schemeFromAddress(wssConsumer?.ConsumerDetails?.currentAddress);
  const warnings: { id: string; tone: "ok" | "warn" | "critical"; icon: IconName; text: string }[] = [];
  if (arrears > 0) warnings.push({ id: "arrears", tone: "critical", icon: "warning", text: t("arrears_warn", { amount: rupees(arrears, { decimals: 0 }) }) });
  if (d.pfLatest !== null && d.pfLatest < 0.9) warnings.push({ id: "pf", tone: "warn", icon: "trendingUp", text: t("pf_risk", { pf: d.pfLatest.toFixed(2) }) });
  if (d.demandPct !== null && d.demandPct >= 85) warnings.push({ id: "demand", tone: d.demandPct >= 100 ? "critical" : "warn", icon: "bolt", text: t("demand_risk", { pct: d.demandPct, kw: d.sanctioned }) });
  if (scheme) warnings.push({ id: "scheme", tone: "ok", icon: "savings", text: t("scheme_ok", { scheme }) });

  const last7 = d.series.slice(-7);
  // Same order as derivePostpaid's series (sorted by measureTime), so dates line up with bars.
  const last7Dates = [...data.consumption_30d.daily]
    .map((r) => String(r.energyImportKWH?.measureTime ?? ""))
    .filter(Boolean)
    .sort()
    .slice(-7)
    .map((x) => new Date(x));
  const budget = useFocusBudget();
  const shown = d.pendingBill?.amount ?? d.projectedBill; // the bill the hero is talking about
  const vsPct = d.pendingBill ? d.pendingBill.vsLast : d.projVsLast; // compare whichever bill Home is showing
  const dueDay = (x: string) => new Date(x).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const vsTone = vsPct >= 10 ? ("warn" as const) : vsPct < 0 ? ("ok" as const) : ("accent" as const);
  const pct = `${vsPct > 0 ? "+" : vsPct < 0 ? "−" : ""}${Math.abs(vsPct)}%`;
  return (
    <>
      <Card style={styles.hero}>
        <Glow />
        {d.hasDues ? (
          <>
            <Txt v="label" color="muted">{t("amount_due")}</Txt>
            <Txt v="hero" numeric color={overdue ? "critical" : "big"}>₹{rupees(d.outstandingAmt, { decimals: 0 })}</Txt>
            {/* The amount is right above; the chip says only when. */}
            {inv && d.daysToDue !== null && (
              <View style={styles.chips}>
                <Pill tone={overdue ? "critical" : "warn"}
                  label={overdue ? t("overdue_since", { date: dueDay(inv.due_dt) })
                    : t(d.daysToDue === 0 ? "due_today" : d.daysToDue === 1 ? "due_tomorrow" : "due_in_days", { n: d.daysToDue, date: dueDay(inv.due_dt) })} />
              </View>
            )}
            <Button label={t("pay_now", { amount: rupees(d.outstandingAmt, { decimals: 0 }) })} onPress={() => router.push("/pay")} />
          </>
        ) : (
          <>
            {d.pendingBill ? (
              <>
                <Txt v="label" color="muted">{t("bill_on_way", { month: month(d.pendingBill.month) })}</Txt>
                <Txt v="hero" numeric color="big">₹{rupees(d.pendingBill.amount, { decimals: 0 })}</Txt>
                <Txt v="label" color="muted" numeric>{t("bill_on_way_line", { next: thisMonth, units: kwh(d.pendingBill.kwh, 0), month: month(d.pendingBill.month) })}</Txt>
              </>
            ) : (
              d.cycleKwh > 0 ? (
                <>
                  <Txt v="label" color="muted">{t("month_so_far", { month: thisMonth })}</Txt>
                  <Txt v="hero" numeric color="big">₹{rupees(d.cycleKwh * d.effectiveRate, { decimals: 0 })}</Txt>
                  <Txt v="label" color="muted" numeric>{t("projected_short", { amount: rupees(d.projectedBill, { decimals: 0 }), month: thisMonth })}</Txt>
                </>
              ) : (
                // First days of a month: a big ₹0 answers nothing, so lead with the month's estimate.
                <>
                  <Txt v="label" color="muted">{t("month_estimate_label", { month: thisMonth })}</Txt>
                  <Txt v="hero" numeric color="big">₹{rupees(d.projectedBill, { decimals: 0 })}</Txt>
                  <Txt v="label" color="muted">{t("month_estimate_line")}</Txt>
                </>
              )
            )}
            {/* Two chips instead of three lines: how it compares, and whether the last bill is settled. */}
            <View style={styles.chips}>
              {d.lastBillAmt > 0 && <Pill tone={vsTone} icon="trendingUp" flipIcon={vsPct < 0} label={t("projected_vs", { pct })} />}
              {billStatus && <Pill tone={billStatus.tone} label={billStatus.chip} />}
              {budget && <Pill tone={shown > budget ? "warn" : "ok"} label={t(shown > budget ? "budget_over" : "budget_ok", { amount: rupees(budget, { decimals: 0 }) })} />}
            </View>
            <HowLink text={t(d.pendingBill ? "how_pending" : d.cycleKwh > 0 ? "how_postpaid" : "how_estimate", {
              rateSrc: t(`rate_src_${d.rateFrom}`, { rate: `₹${rupees(d.effectiveRate, { decimals: 2 })}` }),
              month: d.pendingBill ? month(d.pendingBill.month) : thisMonth,
            })} />
          </>
        )}
      </Card>

      {/* No answer on dues must not read as "nothing due" (the hero then shows an estimate, not ₹0 due). */}
      {!!outstandingError && !outstanding && <Insight tone="warn" icon="warning" text={t("due_unknown")} />}
      {warnings.map((w) => <Insight key={w.id} tone={w.tone} icon={w.icon} text={w.text} />)}

      <QuickActions data={data} onBill={inv ? download : () => router.push("/bills")} billBusy={downloading} hasDues={d.hasDues} />
      {!!pdfError && <ErrorNote error={pdfError} compact />}

      {last7.length > 0 && (
        <Card>
          <View style={styles.cardHead}>
            <Txt v="heading" style={{ flex: 1 }}>{last7Dates.length ? t("chart_to", { date: last7Dates[last7Dates.length - 1].toLocaleDateString(locale, { day: "numeric", month: "short" }) }) : t("last_7")}</Txt>
            <Txt v="caption" color="muted">{t("units")}</Txt>
          </View>
          {/* Month total and rate ride in the chart header instead of two separate tiles. */}
          {d.cycleKwh > 0 && <Txt v="caption" color="muted" numeric style={{ marginTop: -6 }}>{t("month_kwh_rate", { kwh: kwh(d.cycleKwh, 1), rate: rupees(d.effectiveRate, { decimals: 2 }) })}</Txt>}
          <Bars
            values={last7}
            labels={last7Dates.map((x) => String(x.getDate()))}
            details={last7Dates.map((x, i) => `${x.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })} · ${kwh(last7[i], 1)} ${t("units")}`)}
            summary={`${t("last_7")}: ${last7.map((v) => kwh(v, 1)).join(", ")} ${t("units")}`}
          />
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  complaint: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12, minHeight: 64 },
  complaintIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  greeting: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  gear: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  hero: { overflow: "hidden", gap: 10, borderRadius: radius.card },
  bigRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
  ticks: { flexDirection: "row", justifyContent: "space-between" },
  strip: { flexDirection: "row", gap: 12 },
  mini: { flex: 1, gap: 2, borderRadius: radius.tile, padding: 12 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  how: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, alignSelf: "flex-start" },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  kind: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, minHeight: 96, borderRadius: radius.tile, borderWidth: StyleSheet.hairlineWidth, padding: 10, alignItems: "center", justifyContent: "center", gap: 8 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
