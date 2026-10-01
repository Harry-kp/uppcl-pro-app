import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useDashboard, useMe, useMyComplaints, useTenantPreferences, useTickets, useWssConsumer, type ComplaintDetail } from "@shared/api";
import { parseUppclDate, recordSummary } from "@shared/utils";
import { openFor } from "@shared/complaints";
import { HELPLINE_TEL } from "@shared/outage";
import { ErrorNote } from "../../src/errors";
import { useI18n } from "../../src/i18n";
import { font, useColors } from "../../src/theme";
import { Button, Card, Pill, Screen, Txt, familyFor, SkeletonRows, SlowNote } from "../../src/ui";
import { Icon, type IconName } from "../../src/icons";
import { openLink } from "../../src/links";
import { ReportSheet } from "../../src/report";

export default function Complaints() {
  const c = useColors();
  const { t, locale, lang } = useI18n();
  const { data: dash } = useDashboard();
  const { data: me } = useMe();
  const complaints = useMyComplaints(me?.data?.[0]?.phone);
  // UPPCL can hold a different mobile on the bill record; complaints filed from it are listed too.
  const { data: consumer } = useWssConsumer();
  const tail = (p?: string | null) => (p ?? "").replace(/[^0-9]/g, "").slice(-10);
  const billPhone = tail(consumer?.ConsumerDetails?.mobileNo);
  const billComplaints = useMyComplaints(billPhone && billPhone !== tail(me?.data?.[0]?.phone) ? billPhone : null);
  const { data: prefs } = useTenantPreferences();
  const { data: tickets } = useTickets("all");
  const discom = prefs?.data?.discomDetails ?? {};
  const careRaw = (discom.customerCareNumber || discom.helplineNumber || "").trim();
  const care = careRaw.replace(/[^0-9]/g, "") === HELPLINE_TEL ? "" : careRaw; // already the "Call 1912" button above (UX-041)
  // UPPCL SMART's own tickets: a second source that works even when the 1912 portal is down.
  const native = (tickets?.data ?? []).map((r) => recordSummary(r as Record<string, unknown>)).slice(0, 5);
  const list = [...new Map([...(complaints.data?.complaints ?? []), ...(billComplaints.data?.complaints ?? [])].map((x) => [x.complaint_no, x])).values()]
    .sort((a, b) => Number(b.is_open) - Number(a.is_open));
  // Complaints are often filed from a family member's phone (web: ComplaintLookup).
  const [otherInput, setOtherInput] = useState("");
  const [otherPhone, setOtherPhone] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const other = useMyComplaints(otherPhone);
  const otherList = [...(other.data?.complaints ?? [])].sort((a, b) => Number(b.is_open) - Number(a.is_open));
  // UPPCL messages and meter alarms are advanced: they live in Meter details (app/details.tsx).

  // Same complaint flows as Home: the two-tap no-power sheet, and the full form for anything else.
  // SMS / WhatsApp stay inside them as the fallback when 1912 can't take it.
  const { report: fromShortcut } = useLocalSearchParams<{ report?: string }>(); // app-icon shortcut "No power"
  const [report, setReport] = useState(fromShortcut === "1");

  return (
    <Screen onRefresh={() => complaints.mutate()} refreshing={complaints.isValidating}>
      <Txt v="title">{t("complaints_title")}</Txt>

      <Txt v="heading" style={{ marginTop: 4 }}>{t("report_title")}</Txt>
      <Action icon="bolt" title={t("no_power")} desc={t("no_power_desc")} primary disabled={!dash} onPress={() => setReport(true)} />
      {/* The other ways sit side by side, so "Report no power" stays the obvious first choice. */}
      <View style={styles.pair}>
        <Action compact icon="chat" title={t("other_problem")} desc={t("other_problem_short")} onPress={() => router.push("/report")} />
        <Action compact icon="call" title={t("call_1912")} desc={t("call_short")} onPress={() => openLink(`tel:${HELPLINE_TEL}`)} />
      </View>
      {dash && <ReportSheet data={dash} visible={report} onClose={() => setReport(false)} />}

      <View style={{ marginTop: 12 }}>
        <Txt v="heading">{t("status_title")}</Txt>
        <Txt v="caption" color="muted">{t("status_desc")}</Txt>
      </View>
      <Card style={{ padding: 0, gap: 0 }}>
        {complaints.error && list.length === 0 ? (
          // The 1912 portal is a separate UPPCL system and goes down on its own; never show "no complaints" then.
          <View style={{ padding: 8 }}>
            <ErrorNote error={complaints.error} onRetry={() => complaints.mutate()} />
          </View>
        ) : list.length === 0 ? (
          complaints.isLoading || !me ? (
            // The 1912 portal is often slow: the list's shape now, the reason if it drags on.
            <><SkeletonRows n={2} /><View style={{ paddingBottom: 12 }}><SlowNote loading /></View></>
          ) : (
            <View style={[styles.note, { padding: 16, alignItems: "center" }]}>
              <Icon name="checkCircle" size={20} color={c.ok} />
              <Txt v="label" color="muted" style={{ flex: 1 }}>{t("no_complaints")}</Txt>
            </View>
          )
        ) : <ComplaintRows list={list} />}
      </Card>
      {/* Rarely needed, so it stays folded until asked for. */}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showOther }} onPress={() => setShowOther((o) => !o)} style={styles.fold}>
        <Icon name="person" size={18} color={c.primary} />
        <Txt v="label" color="primary" weight="semibold" style={{ flex: 1 }}>{t("other_number")}</Txt>
        <View style={showOther && { transform: [{ rotate: "90deg" }] }}><Icon name="chevronRight" size={20} color={c.primary} /></View>
      </Pressable>
      {showOther && <View style={{ gap: 8 }}>
        <View style={styles.lookup}>
          <TextInput
            value={otherInput} onChangeText={(v) => setOtherInput(v.replace(/[^0-9]/g, "").slice(0, 10))}
            keyboardType="number-pad" placeholder={t("other_number_ph")} placeholderTextColor={c.muted}
            accessibilityLabel={t("other_number")} returnKeyType="search"
            onSubmitEditing={() => otherInput.length === 10 && setOtherPhone(otherInput)}
            style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.line, fontFamily: familyFor("medium", lang === "hi") }]}
          />
          <Button label={t("check")} kind="soft" disabled={otherInput.length !== 10} busy={other.isLoading} onPress={() => setOtherPhone(otherInput)} />
        </View>
        {otherPhone && !other.isLoading && (
          <Card style={{ padding: 0, gap: 0 }}>
            {other.error ? <View style={{ padding: 8 }}><ErrorNote error={other.error} compact /></View>
              : otherList.length === 0 ? <Txt v="label" color="muted" style={{ padding: 16 }}>{t("no_complaints_for", { phone: otherPhone })}</Txt>
              : <ComplaintRows list={otherList} phone={otherPhone} />}
          </Card>
        )}
      </View>}

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

/** Complaint list rows; `phone` is passed on so details work for another number's complaints too. */
function ComplaintRows({ list, phone }: { list: ComplaintDetail[]; phone?: string }) {
  const c = useColors();
  const { t, locale, span } = useI18n();
  // "#PV010126… · 19 May · fixed in 3 h 22 min": the date, and how long UPPCL took (or has taken so far).
  const line = (x: ComplaintDetail) => {
    const d = parseUppclDate(x.entry_date), ms = openFor(x);
    return [`#${x.complaint_no}`, d && d.toLocaleDateString(locale, { day: "numeric", month: "short" }),
      ms !== null && t(x.is_open ? "cx_open_for" : "cx_fixed_in", { t: span(ms) })].filter(Boolean).join(" · ");
  };
  return (
    <>
      {list.slice(0, 10).map((x, i) => (
        <Pressable key={x.complaint_no} accessibilityRole="button"
          onPress={() => router.push({ pathname: "/complaint/[no]", params: phone ? { no: x.complaint_no, phone } : { no: x.complaint_no } })}
          style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Txt v="body" weight="semibold" numberOfLines={1}>{x.sub_type || x.type || t("complaint_no", { no: x.complaint_no })}</Txt>
            <Txt v="caption" color="muted" numeric numberOfLines={1}>{line(x)}</Txt>
          </View>
          <Pill label={x.is_open ? t("open") : t("closed")} tone={x.is_open ? "accent" : "ok"} />
          <Icon name="chevronRight" size={20} color={c.muted} />
        </Pressable>
      ))}
    </>
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

function Action({ icon, title, desc, onPress, primary, disabled, compact }: {
  icon: IconName; title: string; desc: string; onPress: () => void; primary?: boolean; disabled?: boolean; compact?: boolean;
}) {
  const c = useColors();
  const fg = primary ? c.onPrimary : c.text;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.action, compact && styles.compact, primary ? { backgroundColor: c.primary } : { backgroundColor: c.surface, borderColor: c.line, borderWidth: StyleSheet.hairlineWidth }, { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      <View style={[styles.actionIcon, { backgroundColor: primary ? "transparent" : c.pill }]}>
        <Icon name={icon} size={22} color={primary ? c.onPrimary : c.pillText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="heading" style={{ color: fg }}>{title}</Txt>
        <Txt v="caption" color={primary ? undefined : "muted"} style={primary ? { color: fg, opacity: 0.9 } : undefined}>{desc}</Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 20, padding: 14, minHeight: 72 },
  actionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13, minHeight: 60 },
  pair: { flexDirection: "row", gap: 10 },
  compact: { flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 10 },
  note: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  fold: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48 },
  lookup: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, minHeight: 48 },
  contactIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
