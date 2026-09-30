/**
 * Advanced: detailed meter observability for people who want it (web: Meter page + Support
 * alarms). Deliberately off Home/Usage/Complaints; reached from Settings > Your connection and a
 * quiet link at the bottom of Usage. Everyday screens only surface these when they cost money.
 */
import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  useConsumption, useDashboard, useLatestInvoice, useMeterAlarms, useNotifications, useUsageStats, useWssMeter, useYearlyHistory,
  type MonthlyInvoice,
} from "@shared/api";
import { derivePostpaid } from "@shared/insights";
import { mean, toNum } from "@shared/stats";
import { kwh, parseUppclDate, recordSummary } from "@shared/utils";
import { Bars } from "../src/Bars";
import { useI18n } from "../src/i18n";
import { useColors } from "../src/theme";
import { BackHeader, Card, Pill, Screen, Section, Txt, type Tone } from "../src/ui";
import { Icon } from "../src/icons";

export default function MeterDetails() {
  const c = useColors();
  const { t, locale } = useI18n();
  const { data: dash } = useDashboard();
  const { data: wssMeter } = useWssMeter();
  const { data: stats } = useUsageStats();
  const { data: invoice } = useLatestInvoice();
  const { data: yearly } = useYearlyHistory();
  const { data: daily } = useConsumption(90);
  const { data: notes } = useNotifications();
  const { data: alarms } = useMeterAlarms();
  const wm = wssMeter?.data;
  const readAt = parseUppclDate(wm?.previousReadDateTime);

  const q = useMemo(() => {
    if (!dash) return null;
    const inv = (invoice?.data as MonthlyInvoice | undefined)?.invoice_id ? (invoice!.data as MonthlyInvoice) : undefined;
    return derivePostpaid(dash, { inv, stats: stats?.data, yearly: yearly?.data });
  }, [dash, invoice, stats, yearly]);

  // Weekday pattern over 90 days (moved here from Usage: a pattern, not an everyday answer).
  const weekday = useMemo(() => {
    const buckets = Array.from({ length: 7 }, () => [] as number[]);
    for (const r of daily?.data ?? []) {
      const d = new Date(String(r.energyImportKWH?.measureTime ?? ""));
      const v = toNum(r.energyImportKWH?.value);
      if (!Number.isNaN(d.getTime()) && Number.isFinite(v)) buckets[(d.getDay() + 6) % 7].push(v);
    }
    const avg = buckets.map((b) => mean(b));
    return { avg, busiest: avg.indexOf(Math.max(...avg)), enough: buckets.every((b) => b.length >= 2) };
  }, [daily]);
  const dayName = (i: number, style: "short" | "long") => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: style });

  const messages = [...(notes?.data ?? []), ...(alarms?.data ?? [])].map((r) => recordSummary(r as Record<string, unknown>));

  const pfTone: Tone = q?.pfLatest == null ? "ok" : q.pfLatest < 0.9 ? "warn" : "ok";
  const demandTone: Tone = q?.demandPct == null ? "ok" : q.demandPct >= 100 ? "critical" : q.demandPct >= 85 ? "warn" : "ok";

  return (
    <Screen>
      <BackHeader title={t("meter_details")} />
      <Txt v="caption" color="muted">{t("meter_details_desc")}</Txt>

      <Section title={t("meter_section")}>
        {/* A grid of short facts scans faster than a five-row list; status reads as a chip. */}
        <Card style={{ padding: 0, gap: 0 }}>
          {dash && <Row first label={t("meter_no")} value={String(dash.site.meterInstallationNumber || dash.site.deviceId)} />}
          <View style={[styles.grid, { borderTopColor: c.line }]}>
            {!!wm?.purposeOfSupply && <Cell label={t("tariff")} value={wm.purposeOfSupply} />}
            {!!wm?.meterStatus && (
              <Cell label={t("meter_status")}>
                <Pill tone={/active/i.test(wm.meterStatus) ? "ok" : "warn"} label={wm.meterStatus} />
              </Cell>
            )}
            {!!dash?.site.sanctionedLoad && <Cell label={t("sanctioned_load")} value={`${kwh(toNum(dash.site.sanctionedLoad), 0)} kW`} />}
            {!!wm?.previousReadingKWH && (
              <Cell label={t("last_reading")} value={`${kwh(toNum(wm.previousReadingKWH), 0)} kWh`}
                sub={readAt ? readAt.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : undefined} />
            )}
          </View>
        </Card>
      </Section>

      {q && (q.pfLatest !== null || q.demandPct !== null) && (
        <Section title={t("power_quality")}>
          <Card>
            {q.pfLatest !== null && (
              <View style={styles.metric}>
                <View style={{ flex: 1 }}>
                  <Txt v="body" weight="semibold">{t("power_factor")}</Txt>
                  <Txt v="caption" color="muted">{t("pf_desc")}</Txt>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Txt v="value" numeric>{q.pfLatest.toFixed(2)}</Txt>
                  <Pill tone={pfTone} label={pfTone === "ok" ? t("healthy") : t("penalty_risk")} />
                </View>
              </View>
            )}
            {q.demandPct !== null && (
              <View style={{ gap: 8, marginTop: q.pfLatest !== null ? 8 : 0 }}>
                <View style={styles.metric}>
                  <View style={{ flex: 1 }}>
                    <Txt v="body" weight="semibold">{t("peak_demand")}</Txt>
                    <Txt v="caption" color="muted">{t("peak_desc", { kw: kwh(q.sanctioned, 0) })}</Txt>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Txt v="value" numeric>{`${kwh(q.peakKw, 1)} kW`}</Txt>
                    <Pill tone={demandTone} label={`${q.demandPct}%`} />
                  </View>
                </View>
                {/* Gauge: fill = share of sanctioned load; tick at 85% where the penalty risk starts. */}
                <View style={[styles.track, { backgroundColor: c.track }]} accessibilityLabel={`${q.demandPct}%`}>
                  <View style={[styles.fill, { width: `${Math.min(100, q.demandPct)}%`, backgroundColor: demandTone === "ok" ? c.primary : c[demandTone] }]} />
                  <View style={[styles.tick, { left: "85%", backgroundColor: c.muted }]} />
                </View>
              </View>
            )}
          </Card>
        </Section>
      )}

      {weekday.enough && (
        <Section title={t("by_weekday")} caption={`${t("busiest_day")}: ${dayName(weekday.busiest, "long")}`}>
          <Card>
            <Bars
              values={weekday.avg}
              highlight={weekday.busiest}
              labels={weekday.avg.map((_, i) => dayName(i, "short"))}
              details={weekday.avg.map((v, i) => `${dayName(i, "long")} · ${kwh(v, 1)} kWh`)}
              summary={weekday.avg.map((v, i) => `${dayName(i, "long")} ${kwh(v, 1)}`).join(", ")}
            />
          </Card>
        </Section>
      )}

      <Section title={t("messages_title")}>
        <Card style={{ padding: 0, gap: 0 }}>
          {messages.length === 0 ? (
            <View style={styles.row}>
              <Icon name="checkCircle" size={20} color={c.ok} />
              <Txt v="label" color="muted" style={{ flex: 1 }}>{t("no_messages")}</Txt>
            </View>
          ) : messages.slice(0, 10).map((r, i) => (
            <View key={i} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
              <Icon name="notifications" size={20} color={c.muted} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Txt v="body" weight="semibold" numberOfLines={2}>{r.title}</Txt>
                {(r.subtitle || r.date) && (
                  <Txt v="caption" color="muted" numberOfLines={2}>
                    {[r.subtitle, r.date && parseUppclDate(r.date)?.toLocaleDateString(locale, { day: "numeric", month: "short" })].filter(Boolean).join(" · ")}
                  </Txt>
                )}
              </View>
            </View>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}

function Cell({ label, value, sub, children }: { label: string; value?: string; sub?: string; children?: ReactNode }) {
  return (
    <View style={styles.cell}>
      <Txt v="caption" color="muted">{label}</Txt>
      {value !== undefined && <Txt v="body" weight="semibold" numeric>{value}</Txt>}
      {children}
      {sub && <Txt v="caption" color="muted">{sub}</Txt>}
    </View>
  );
}

function Row({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.detail, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
      <Txt v="caption" color="muted">{label}</Txt>
      <Txt v="body" weight="semibold">{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  detail: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 56, justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 4 },
  cell: { width: "50%", paddingHorizontal: 8, paddingVertical: 10, gap: 3 },
  metric: { flexDirection: "row", alignItems: "center", gap: 12 },
  track: { height: 8, borderRadius: 4, overflow: "visible" },
  fill: { height: "100%", borderRadius: 4 },
  tick: { position: "absolute", top: -3, width: 2, height: 14, borderRadius: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13, minHeight: 56 },
});
