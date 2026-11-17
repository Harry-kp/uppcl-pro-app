import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useDashboard, useMyComplaints, useSeenComplaintDetail, useTenantPreferences, useTickets, type ComplaintDetail } from "@shared/api";
import { parseUppclDate, recordSummary } from "@shared/utils";
import { CGRF_URL, cgrfNodalUrl, connected1912, HELPLINE_TEL, JANSUNWAI_URL, is1912LoginOnly, lateBy, needsKyc1912, openFor, signedIn1912 } from "@shared/complaints";
import { Connect1912Sheet } from "../../src/connect1912";
import { ErrorNote } from "../../src/errors";
import { useI18n } from "../../src/i18n";
import { font, useColors } from "../../src/theme";
import { ActionTile, Insight, Button, Card, Pill, Screen, Txt, SkeletonRows, SlowNote } from "../../src/ui";
import { Icon, type IconName } from "../../src/icons";
import { openLink } from "../../src/links";
import { DangerRow, openPlannedCuts, ReportSheet } from "../../src/report";

export default function Complaints() {
  const c = useColors();
  const { t, locale } = useI18n();
  const { data: dash } = useDashboard();
  const complaints = useMyComplaints();
  const { data: prefs } = useTenantPreferences();
  const { data: tickets } = useTickets("all");
  const discom = prefs?.data?.discomDetails ?? {};
  const careRaw = (discom.customerCareNumber || discom.helplineNumber || "").trim();
  const care = careRaw.replace(/[^0-9]/g, "") === HELPLINE_TEL ? "" : careRaw; // already the "Call 1912" button above (UX-041)
  // UPPCL SMART's own tickets: a second source that works even when the 1912 portal is down.
  const native = (tickets?.data ?? []).map((r) => recordSummary(r as Record<string, unknown>)).slice(0, 5);
  const list = complaints.data?.complaints ?? [];
  // 1912 needs its own OTP sign-in (UPPCL, Oct 2026). Its last list stays: the code is asked for only to refresh.
  const [connect, setConnect] = useState(false);
  const linked = !!connected1912();
  const expired = is1912LoginOnly(complaints.error);
  // UPPCL messages and meter alarms are advanced: they live in Meter details (app/details.tsx).

  // Same complaint flows as Home: the two-tap no-power sheet, and the full form for anything else.
  // SMS / WhatsApp stay inside them as the fallback when 1912 can't take it.
  const { report: fromShortcut } = useLocalSearchParams<{ report?: string }>(); // app-icon shortcut "No power"
  const [report, setReport] = useState(fromShortcut === "1");
  const [planBusy, setPlanBusy] = useState(false);

  return (
    <Screen onRefresh={() => (linked && !expired ? complaints.mutate() : setConnect(true))} refreshing={complaints.isValidating}>
      <Txt v="title">{t("complaints_title")}</Txt>

      <Txt v="heading" style={{ marginTop: 4 }}>{t("report_title")}</Txt>
      <ActionTile icon="bolt" title={t("no_power")} desc={t(signedIn1912() ? "no_power_desc" : "no_power_desc_connect")} primary disabled={!dash} onPress={() => setReport(true)} />
      {/* The other ways sit side by side, so "Report no power" stays the obvious first choice. */}
      <View style={styles.pair}>
        <ActionTile icon="widgets" title={t("other_problem")} desc={t("other_problem_short")} onPress={() => router.push("/report")} />
        <ActionTile icon="call" title={t("call_1912")} desc={t("call_short")} onPress={() => openLink(`tel:${HELPLINE_TEL}`)} />
      </View>
      <DangerRow />
      {/* Is it a planned cut? PVVNL posts the day's list as a PDF (the only discom that does). */}
      {String(dash?.site.tenantId ?? "").toUpperCase() === "PVVNL" && (
        <Card style={{ padding: 0, gap: 0 }}>
          <Contact first icon="event" label={t("planned_title")} value={planBusy ? t("planned_opening") : t("planned_value")}
            onPress={() => { if (planBusy) return; setPlanBusy(true); void openPlannedCuts().finally(() => setPlanBusy(false)); }} />
        </Card>
      )}
      {dash && <ReportSheet data={dash} visible={report} onClose={() => setReport(false)} />}

      <View style={{ marginTop: 12 }}>
        <Txt v="heading">{t("status_title")}</Txt>
        <Txt v="caption" color="muted">{t("status_desc")}</Txt>
      </View>
      {!linked ? (
        // Never an empty, locked list: what connecting gets you, and one button.
        <Card>
          <View style={styles.note}>
            <Icon name="lock" size={20} color={c.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="body" weight="semibold">{t("c19_card_title")}</Txt>
              <Txt v="caption" color="muted">{t("c19_card_body")}</Txt>
            </View>
          </View>
          <Button label={t("c19_connect")} icon="lock" onPress={() => setConnect(true)} />
        </Card>
      ) : (
        <>
          {expired && (
            <Pressable accessibilityRole="button" onPress={() => setConnect(true)} style={[styles.stale, { backgroundColor: c.pill }]}>
              <Icon name="refresh" size={18} color={c.pillText} />
              <Txt v="label" color="pillText" style={{ flex: 1 }}>{t(list.length ? "c19_stale" : "c19_expired")}</Txt>
              <Txt v="label" color="pillText" weight="bold">{t("c19_refresh")}</Txt>
            </Pressable>
          )}
          {needsKyc1912() && <Insight tone="accent" icon="info" text={t("c19_kyc_body")} />}
          <Card style={{ padding: 0, gap: 0 }}>
            {complaints.error && !expired && list.length === 0 ? (
              // The 1912 portal is a separate UPPCL system and goes down on its own; never show "no complaints" then.
              <View style={{ padding: 8 }}><ErrorNote error={complaints.error} onRetry={() => complaints.mutate()} /></View>
            ) : list.length === 0 ? (
              complaints.isLoading ? (
                <><SkeletonRows n={2} /><View style={{ paddingBottom: 12 }}><SlowNote loading /></View></>
              ) : !expired ? (
                <View style={[styles.note, { padding: 16, alignItems: "center" }]}>
                  <Icon name="checkCircle" size={20} color={c.ok} />
                  <Txt v="label" color="muted" style={{ flex: 1 }}>{t("no_complaints")}</Txt>
                </View>
              ) : null
            ) : <ComplaintRows list={list} />}
          </Card>
          {!!complaints.data?.phone && <Txt v="caption" color="muted">{t("c19_listed_for", { mobile: `•••• ${complaints.data.phone.slice(-4)}` })}</Txt>}
        </>
      )}
      <Connect1912Sheet visible={connect} onClose={() => setConnect(false)} />

      {native.length > 0 && (
        <>
          <Txt v="heading" style={{ marginTop: 12 }}>{t("uppcl_tickets")}</Txt>
          <Card style={{ padding: 0, gap: 0 }}>
            {native.map((r, i) => (
              <View key={i} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt v="body" weight="semibold" numberOfLines={1}>{r.title}</Txt>
                  {(r.subtitle || r.date) && (
                    <Txt v="caption" color="muted" numberOfLines={1}>
                      {[r.subtitle, r.date && parseUppclDate(r.date)?.toLocaleDateString(locale, { day: "numeric", month: "short" })].filter(Boolean).join(" · ")}
                    </Txt>
                  )}
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {/* Not solved? The official next steps, in order: the consumer forum, its nodal officer for this discom, the state portal. */}
      {dash && (() => {
        const code = String(dash.site.tenantId).toUpperCase();
        return (
          <>
            <View style={{ marginTop: 12 }}>
              <Txt v="heading">{t("esc_title")}</Txt>
              <Txt v="caption" color="muted">{t("esc_desc")}</Txt>
            </View>
            <Card style={{ padding: 0, gap: 0 }}>
              <Contact first icon="supportAgent" label={t("esc_cgrf")} value={t("esc_cgrf_value")} onPress={() => openLink(CGRF_URL)} />
              <Contact icon="person" label={t("esc_nodal", { discom: code })} value={t("esc_nodal_value")} onPress={() => openLink(cgrfNodalUrl(code))} />
              <Contact icon="openInNew" label={t("esc_jansunwai")} value={t("esc_jansunwai_value")} onPress={() => openLink(JANSUNWAI_URL)} />
            </Card>
          </>
        );
      })()}

      {(care || discom.email || discom.address) && (
        <>
          <Txt v="heading" style={{ marginTop: 12 }}>{t("contact_title")}</Txt>
          <Card style={{ padding: 0, gap: 0 }}>
            {!!care && <Contact first icon="call" label={t("customer_care")} value={care} onPress={() => openLink(`tel:${care}`)} />}
            {!!discom.email && <Contact first={!care} icon="mail" label={t("email")} value={discom.email} onPress={() => openLink(`mailto:${discom.email}`)} />}
            {!!discom.address && <Contact first={!care && !discom.email} icon="home" label={t("billing_office")} value={discom.address} lines={3}
              onPress={() => openLink(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(discom.address!)}`)} />}
          </Card>
        </>
      )}
    </Screen>
  );
}

/** Complaint list rows. */
function ComplaintRows({ list }: { list: ComplaintDetail[] }) {
  return <>{list.slice(0, 10).map((x, i) => <ComplaintRow key={x.complaint_no} x={x} first={i === 0} />)}</>;
}

function ComplaintRow({ x, first }: { x: ComplaintDetail; first: boolean }) {
  const c = useColors();
  const { t, locale, span } = useI18n();
  // Late only once its full record has been seen (it has the times and UPPCL's limit); the list itself has dates only.
  const { data: seen } = useSeenComplaintDetail(x.complaint_no);
  const late = seen ? lateBy(seen) : null;
  const what = x.sub_type || x.type || t("complaint_no", { no: x.complaint_no });
  // "#PV010126… · 19 May · fixed in 3 h 22 min": the date, and how long UPPCL took (or has taken so far).
  const d = parseUppclDate(x.entry_date), ms = openFor(seen ?? x);
  const line = [`#${x.complaint_no}`, d && d.toLocaleDateString(locale, { day: "numeric", month: "short" }),
    ms !== null && t(x.is_open ? "cx_open_for" : "cx_fixed_in", { t: span(ms) })].filter(Boolean).join(" · ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={late !== null && !x.is_open ? t("cx_late_a11y", { type: what, h: late }) : undefined}
      onPress={() => router.push({ pathname: "/complaint/[no]", params: { no: x.complaint_no } })}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="body" weight="semibold" numberOfLines={1}>{what}</Txt>
        <Txt v="caption" color="muted" numeric numberOfLines={1}>{line}</Txt>
      </View>
      {/* "Late" replaces "Closed" (never a second chip); text + warn tone, not colour alone. */}
      <Pill label={late !== null && !x.is_open ? t("late_pill") : x.is_open ? t("open") : t("closed")} tone={late !== null ? "warn" : x.is_open ? "accent" : "ok"} />
      <Icon name="chevronRight" size={20} color={c.muted} />
    </Pressable>
  );
}

function Contact({ icon, label, value, onPress, first, lines = 1 }: { icon: IconName; label: string; value: string; onPress: () => void; first?: boolean; lines?: number }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${value}`} onPress={onPress}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
      <View style={[styles.contactIcon, { backgroundColor: c.pill }]}><Icon name={icon} size={20} color={c.pillText} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="caption" color="muted">{label}</Txt>
        <Txt v="body" weight="semibold" numeric numberOfLines={lines}>{value}</Txt>
      </View>
      <Icon name="chevronRight" size={20} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13, minHeight: 60 },
  pair: { flexDirection: "row", gap: 10 },
  note: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stale: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, paddingHorizontal: 14, minHeight: 48 },
  contactIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
