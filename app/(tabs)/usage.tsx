import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useConsumption, useDashboard, useLatestInvoice, useSavingTip, useYearlyHistory, type MonthlyInvoice } from "@shared/api";
import { derivePostpaid } from "@shared/insights";
import { mean, stddev, toNum } from "@shared/stats";
import { FALLBACK_RATE, kwh, rupees } from "@shared/utils";
import { Bars } from "../../src/Bars";
import { ErrorNote } from "../../src/errors";
import { useI18n } from "../../src/i18n";
import { Card, Centered, Insight, Pill, Screen, Segmented, Txt } from "../../src/ui";
import { Icon } from "../../src/icons";
import { useColors } from "../../src/theme";

type Range = "7" | "30" | "90" | "365";

export default function Usage() {
  const c = useColors();
  const { t, locale } = useI18n();
  const [range, setRange] = useState<Range>("30");
  // 12 months uses UPPCL's monthly rollups (YearView); keep the daily hook on a cached range.
  // 7 and 30 days fetch twice the range in one request, so the screen can say how this period
  // compares with the one before it. 90 stays 90 (shared with Meter details' cache).
  const n = range === "365" ? 30 : Number(range);
  const { data, error, isLoading, mutate, isValidating } = useConsumption(n === 90 ? 90 : n * 2);
  const { data: dash } = useDashboard();
  const postpaid = dash?.site.connectionType === "postpaid";
  const { data: invoice } = useLatestInvoice();
  const { data: yearly } = useYearlyHistory();
  // Same ₹/kWh as Home: postpaid's comes from the last bill ÷ that month's kWh.
  const rate = useMemo(() => {
    if (!dash) return FALLBACK_RATE;
    if (!postpaid) return dash.consumption_30d.effective_rate || FALLBACK_RATE;
    const inv = (invoice?.data as MonthlyInvoice | undefined)?.invoice_id ? (invoice!.data as MonthlyInvoice) : undefined;
    return derivePostpaid(dash, { inv, yearly: yearly?.data }).effectiveRate;
  }, [dash, postpaid, invoice, yearly]);

  const s = useMemo(() => {
    const rows = [...(data?.data ?? [])].sort((a, b) =>
      String(a.energyImportKWH?.measureTime ?? "").localeCompare(String(b.energyImportKWH?.measureTime ?? "")));
    const all = rows.map((r) => toNum(r.energyImportKWH?.value));
    const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const values = all.slice(-n);
    // UPPCL sometimes returns a day or two short, so accept ≥80% of the earlier period and compare daily averages.
    const prev = all.slice(Math.max(0, all.length - 2 * n), -n).filter(Number.isFinite);
    const dates = rows.slice(-n).map((r) => new Date(String(r.energyImportKWH?.measureTime ?? "")));
    const pm = mean(prev), cm = mean(values);
    const vsPrev = n !== 90 && prev.length >= n * 0.8 && pm > 0 ? Math.round(((cm - pm) / pm) * 100) : null;
    const total = values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const avg = mean(values), sd = stddev(values);
    // Same rule as the web dashboard's anomaly flag: z ≥ 1.5.
    const flagged = sd > 0 ? values.map((v, i) => ((v - avg) / sd >= 1.5 ? i : -1)).filter((i) => i >= 0) : [];
    const top = flagged.length ? flagged.reduce((a, b) => (values[b] > values[a] ? b : a)) : null;
    // Average kWh per weekday, Monday first.
    const buckets = Array.from({ length: 7 }, () => [] as number[]);
    values.forEach((v, i) => Number.isFinite(v) && buckets[(dates[i].getDay() + 6) % 7].push(v));
    const weekday = buckets.map((b) => mean(b));
    const busiest = weekday.indexOf(Math.max(...weekday));
    return { values, dates, total, avg, flagged, top, weekday, busiest, vsPrev };
  }, [data, n]);

  const weekdayName = (i: number, style: "short" | "long") =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: style }); // 1 Jan 2024 was a Monday

  if (error && !data) return <Screen><View style={{ marginTop: 24 }}><ErrorNote error={error} onRetry={() => mutate()} /></View></Screen>;

  return (
    <Screen onRefresh={() => mutate()} refreshing={isValidating}>
      <Txt v="title">{t("usage_title")}</Txt>
      {error && data && <ErrorNote error={error} stale compact />}
      <Segmented<Range>
        value={range}
        onChange={setRange}
        options={[{ value: "7", label: t("range_7") }, { value: "30", label: t("range_30") }, { value: "90", label: t("range_90") }, { value: "365", label: t("range_12") }]}
      />

      {range === "365" ? (
        <YearView rate={rate} />
      ) : isLoading || !data ? (
        <Centered><ActivityIndicator color={c.primary} /></Centered>
      ) : (
        <>
          <Card>
            <View style={styles.head}>
              <View>
                <Txt v="caption" color="muted">{t("total")}</Txt>
                <Txt v="value" numeric>{kwh(s.total, 1)} {t("units")}</Txt>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Txt v="caption" color="muted">{t("avg_day")}</Txt>
                <Txt v="value" numeric>{kwh(s.avg, 1)} {t("units")}</Txt>
              </View>
            </View>
            <View style={styles.chips}>
              <Txt v="label" color="muted">{t("est_cost", { amount: rupees(s.total * rate, { decimals: 0 }) })}</Txt>
              {/* The answer to "is this normal?": ±5% reads as the same. */}
              {s.vsPrev !== null && (
                Math.abs(s.vsPrev) < 5
                  ? <Pill tone="ok" label={t("same_as_prev", { n })} />
                  : <Pill tone={s.vsPrev > 0 ? "warn" : "ok"} icon="trendingUp" flipIcon={s.vsPrev < 0}
                      label={t(s.vsPrev > 0 ? "more_than_prev" : "less_than_prev", { pct: Math.abs(s.vsPrev), n })} />
              )}
            </View>
            <Bars
              values={s.values}
              flagged={s.flagged}
              highlightLast={range === "7"}
              labels={s.dates.map((d) => String(d.getDate()))}
              details={s.dates.map((d, i) => `${d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })} · ${kwh(s.values[i], 1)} ${t("units")}`)}
              height={140}
              summary={`${t("total")} ${kwh(s.total, 1)} ${t("units")}, ${t("avg_day")} ${kwh(s.avg, 1)} ${t("units")}`}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name={s.top !== null ? "warning" : "checkCircle"} size={16} color={s.top !== null ? c.warn : c.ok} />
              <Txt v="label" color={s.top !== null ? "warn" : "muted"} style={{ flex: 1 }}>
                {s.top !== null
                  ? t(s.flagged.length > 1 ? "unusual_days" : "unusual_day", {
                      n: String(s.flagged.length),
                      date: s.dates[s.top].toLocaleDateString(locale, { day: "numeric", month: "short" }),
                      v: kwh(s.values[s.top], 1),
                      avg: kwh(s.avg, 1),
                    })
                  : t("no_unusual")}
              </Txt>
            </View>
          </Card>

        </>
      )}

      <SavingTip />

      {/* Advanced: detailed patterns and meter data, for those who want them. */}
      <Pressable accessibilityRole="button" onPress={() => router.push("/details")} style={styles.more}>
        <Txt v="label" color="primary" weight="semibold">{t("more_details")}</Txt>
        <Icon name="chevronRight" size={18} color={c.primary} />
      </Pressable>
    </Screen>
  );
}

/** One energy-saving tip written by UPPCL, in the user's language; rotates through appliances by week. */
// savingTip/getOne rejects "nightbaseload" ("Invalid appliance"), so it isn't in the rotation.
const TIP_APPLIANCES = ["ac", "fridge", "geyser", "washing_machine", "tv", "others"] as const;
function SavingTip() {
  const { t, lang } = useI18n();
  const week = Math.floor(Date.now() / (7 * 86400_000));
  const { data } = useSavingTip(TIP_APPLIANCES[week % TIP_APPLIANCES.length]);
  const tip = data?.data?.[0];
  const text = (lang === "hi" ? tip?.tipHindi : tip?.tipEnglish) || tip?.tipEnglish;
  if (!text) return null;
  return <Insight tone="ok" icon="savings" text={`${t("tip_title")}: ${text.trim()}`} />;
}

/** 12 monthly bars from this year's + last year's rollups, and last complete month vs the same month a year earlier. */
function YearView({ rate }: { rate: number }) {
  const { t, locale } = useI18n();
  const year = new Date().getFullYear();
  const thisYear = useYearlyHistory(year);
  const lastYear = useYearlyHistory(year - 1);

  const m = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const r of [...(lastYear.data?.data ?? []), ...(thisYear.data?.data ?? [])]) {
      const at = new Date(String(r.energyImportKWH?.measureTime ?? ""));
      const v = toNum(r.energyImportKWH?.value);
      if (Number.isNaN(at.getTime()) || !Number.isFinite(v)) continue;
      byMonth.set(`${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`, v);
    }
    const keys = [...byMonth.keys()].sort().slice(-12);
    const months = keys.map((k) => new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 1));
    const values = keys.map((k) => byMonth.get(k)!);
    // Compare the last *complete* month: the current one is still filling up.
    const now = new Date();
    const lastFull = [...keys].reverse().find((k) => k !== `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    let vs: { pct: number; month: Date } | null = null;
    if (lastFull) {
      const prevKey = `${Number(lastFull.slice(0, 4)) - 1}${lastFull.slice(4)}`;
      const cur = byMonth.get(lastFull)!, prev = byMonth.get(prevKey);
      if (prev && prev > 0) vs = { pct: Math.round(((cur - prev) / prev) * 100), month: new Date(Number(lastFull.slice(0, 4)), Number(lastFull.slice(5)) - 1, 1) };
    }
    return { months, values, total: values.reduce((a, b) => a + b, 0), vs };
  }, [thisYear.data, lastYear.data]);

  if (thisYear.isLoading && !thisYear.data) return <Centered><Txt v="body" color="muted">{t("loading")}</Txt></Centered>;
  const monthLong = (d: Date) => d.toLocaleDateString(locale, { month: "long" });
  return (
    <Card>
      <View style={styles.head}>
        <View>
          <Txt v="caption" color="muted">{t("total")}</Txt>
          <Txt v="value" numeric>{kwh(m.total, 0)} {t("units")}</Txt>
          {m.values.length < 12 && <Txt v="caption" color="muted">{t("months_of_data", { n: m.values.length })}</Txt>}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Txt v="caption" color="muted">{t("est_cost", { amount: rupees(m.total * rate, { decimals: 0 }) })}</Txt>
        </View>
      </View>
      <Bars
        values={m.values}
        highlightLast={false}
        labels={m.months.map((d) => d.toLocaleDateString(locale, { month: "short" }))}
        hint={t("tap_bar_month")}
        details={m.months.map((d, i) => t("monthly_total", { month: d.toLocaleDateString(locale, { month: "short", year: "numeric" }), kwh: kwh(m.values[i], 0) }))}
        height={140}
        summary={`${t("range_12")}: ${kwh(m.total, 0)} ${t("units")}`}
      />
      {m.vs && (
        <View style={styles.chips}>
          <Pill tone={m.vs.pct > 10 ? "warn" : m.vs.pct < -10 ? "ok" : "accent"} icon="trendingUp" flipIcon={m.vs.pct < 0}
            label={t("vs_last_year", { pct: `${m.vs.pct > 0 ? "+" : m.vs.pct < 0 ? "−" : ""}${Math.abs(m.vs.pct)}%`, month: monthLong(m.vs.month) })} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between" },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  more: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, alignSelf: "center" },
});
