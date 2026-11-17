import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useCompensationCheck, useComplaintDetail, useMyComplaints } from "@shared/api";
import { CGRF_URL, CLAIM_DAYS, COMPENSATION_FORM_URL, lateBy, openFor, sourceKind } from "@shared/complaints";
import { parseUppclDate } from "@shared/utils";
import { useI18n } from "../../src/i18n";
import { useColors } from "../../src/theme";
import { BackHeader, Button, Card, Insight, Pill, Screen, Skeleton, SkeletonRows, SlowNote, Txt } from "../../src/ui";
import { openLink } from "../../src/links";
import { Icon } from "../../src/icons";
import { TextLink } from "../../src/report";

export default function ComplaintDetail() {
  const c = useColors();
  const { t, locale, span, upstream } = useI18n();
  const { no } = useLocalSearchParams<{ no: string }>();
  const { data } = useMyComplaints(); // already cached by the list
  const row = data?.complaints.find((k) => k.complaint_no === no);
  const { data: full, isLoading: more } = useComplaintDetail(no); // remarks, officers, area: ~4 s more
  // Only a record that is this complaint (a stale or odd cached answer must not replace the list row: BUG-030).
  const x = full?.complaint_no === no ? full : row;
  // "30/09/2026 07:42:00 PM" (BUG-063): with the time, since how long a fix took is the point here.
  // The signed-in list has dates only ("19-May-2026"): then no made-up "12:00 am".
  const when = (d: string | null) => parseUppclDate(d)?.toLocaleString(locale, d?.includes(":")
    ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" }) ?? null;

  // 1912 takes a compensation claim for 60 days from the complaint; ask its pre-check only inside that window.
  // (Before the early return below: hooks run on every render.)
  const filedAt = parseUppclDate(x?.entry_date ?? null);
  const claimBy = filedAt ? new Date(filedAt.getTime() + CLAIM_DAYS * 86_400_000) : null;
  const claimOpen = !!claimBy && claimBy.getTime() > Date.now();
  const claim = useCompensationCheck(x && !x.is_open && lateBy(x) !== null && claimOpen ? x.complaint_no : null);

  if (!x) return (
    <Screen>
      <BackHeader title={`#${no ?? ""}`} />
      <Card><Skeleton w="50%" h={20} /><Skeleton w="70%" h={14} /><Skeleton w="60%" h={14} /></Card>
      <Card style={{ padding: 0, gap: 0 }}><SkeletonRows n={3} /></Card>
      <SlowNote loading />
    </Screen>
  );

  const took = openFor(x);
  const late = lateBy(x); // whole hours past UPPCL's own limit, only when measurable

  const src = sourceKind(x.source);
  const closingNote = !x.is_open && x.closing_remarks && x.closing_remarks !== x.remarks ? x.closing_remarks : null;
  // Escalation chain, lowest first. Only officers UPPCL actually assigned (a number is enough to call).
  const officers = [
    { role: t("je"), name: x.je_name, phone: x.je_mobile },
    { role: t("ae"), name: x.ae_name, phone: x.ae_mobile },
    { role: t("xen"), name: x.xen_name, phone: x.xen_mobile },
  ].filter((o) => o.name || o.phone);

  return (
    <Screen>
      <BackHeader title={`#${x.complaint_no}`} />

      <Card>
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="heading">{upstream(x.sub_type || x.type || x.status || "")}</Txt>
            {!!x.type && x.type !== x.sub_type && <Txt v="caption" color="muted">{upstream(x.type)}</Txt>}
          </View>
          <Pill label={late !== null && !x.is_open ? t("late_pill") : x.is_open ? t("open") : t("closed")} tone={late !== null ? "warn" : x.is_open ? "accent" : "ok"} />
        </View>

        {/* Filed → closed, with how long it took: the one number people care about after a power cut. */}
        <View style={{ gap: 0, marginTop: 4 }}>
          <Step dot={c.primary} line={c.line} title={t("cx_filed")} time={when(x.entry_date)} note={src ? t("cx_via", { src: t(`cx_src_${src}`) }) : null} />
          <Step dot={x.is_open ? c.warn : c.ok} last title={x.is_open ? t("cx_still_open") : t("cx_closed")}
            time={x.is_open ? null : when(x.closing_date)}
            note={took !== null ? t(x.is_open ? "cx_so_far" : "cx_took", { t: span(took) }) : null} />
        </View>
        {/* UPPCL's own limit for this kind of fault (1912's escalation chart): two plain lines, no sums. */}
        {!!x.limit_hours && (
          <View style={{ gap: 2, marginTop: 4 }}>
            <Txt v="body" weight="semibold">{t("cx_limit", { h: x.limit_hours })}{late !== null && !x.is_open ? ` · ${t("cx_late", { h: late })}` : ""}</Txt>
            <Txt v="caption" color="muted">{t("cx_limit_src")}</Txt>
          </View>
        )}
        {/* 1912 publishes no limit for some kinds (e.g. major power failure): say so instead of staying silent (UX-R38). */}
        {full?.complaint_no === no && full.limit_hours === null && <Txt v="caption" color="muted">{t("cx_no_limit")}</Txt>}
      </Card>

      {/* Open and already past the limit: the moment calling the JE helps (the numbers are just below). */}
      {x.is_open && late !== null && !!x.limit_hours && <Insight tone="warn" icon="schedule" text={t("cx_open_late", { h: x.limit_hours })} />}
      {/* Past UPPCL's own limit: the official next step is the consumer forum (Complaints tab has the full list). */}
      {late !== null && <TextLink label={t("cx_escalate")} onPress={() => openLink(CGRF_URL)} />}

      {/* Closed late: 1912 takes a compensation claim for 60 days. Its own pre-check says if it will (not whether it
          pays: UPPCL decides after registering). No amounts promised. */}
      {!x.is_open && late !== null && (
        <Card style={{ gap: 8 }}>
          <Txt v="body" weight="semibold">{t("cx_comp_title")}</Txt>
          {claimOpen ? (
            <>
              <Txt v="body" color="muted">{t("cx_comp_until", { date: claimBy!.toLocaleDateString(locale, { day: "numeric", month: "long" }) })}</Txt>
              {claim.data && !claim.data.possible && <Insight tone="warn" icon="info" text={t("cx_comp_refused", { why: claim.data.reasons.join("; ") || "—" })} />}
              <Txt v="caption" color="muted">{t("cx_comp_steps", { no: x.complaint_no })}</Txt>
              <Txt v="caption" color="muted">{t("cx_comp_arrears")}</Txt>
              <Button kind="soft" icon="openInNew" label={t("cx_comp_how")} onPress={() => openLink(COMPENSATION_FORM_URL)} />
            </>
          ) : (
            <Txt v="body" color="muted">{claimBy ? t("cx_comp_closed", { date: claimBy.toLocaleDateString(locale, { day: "numeric", month: "long" }) }) : t("cx_comp_body")}</Txt>
          )}
        </Card>
      )}

      {(!!x.remarks || !!closingNote) && (
        <Card>
          {!!x.remarks && <Said label={t("cx_you_said")} text={x.remarks} />}
          {!!closingNote && <Said label={t("cx_uppcl_did")} text={closingNote} />}
        </Card>
      )}

      {!full && more && <Card style={{ padding: 0, gap: 0 }}><SkeletonRows n={3} /></Card>}

      {officers.length > 0 && (
        <>
          <View style={{ marginTop: 8, gap: 2 }}>
            <Txt v="heading">{t(x.is_open ? "handled_by" : "handled_by_past")}</Txt>
            {x.is_open && <Txt v="caption" color="muted">{t("cx_call_order")}</Txt>}
          </View>
          <Card style={{ padding: 0, gap: 0 }}>
            {officers.map((o, i) => (
              <View key={o.role} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt v="caption" color="muted">{o.role}</Txt>
                  <Txt v="body" weight="semibold" numberOfLines={1} color={o.name ? undefined : "muted"}>{o.name || t("cx_no_name")}</Txt>
                </View>
                {o.phone && (
                  <Pressable accessibilityRole="button" accessibilityLabel={t("call_x", { name: o.name ?? o.role })}
                    onPress={() => Linking.openURL(`tel:${o.phone}`)} hitSlop={8}
                    style={({ pressed }) => [styles.call, { backgroundColor: c.pill, opacity: pressed ? 0.8 : 1 }]}>
                    <Icon name="call" size={18} color={c.pillText} />
                    <Txt v="label" color="pillText" weight="bold">{t("call")}</Txt>
                  </Pressable>
                )}
              </View>
            ))}
          </Card>
        </>
      )}

      {(!!x.substation || !!x.subdivision) && (
        <>
          <Txt v="heading" style={{ marginTop: 8 }}>{t("cx_area")}</Txt>
          <Card style={{ padding: 0, gap: 0 }}>
            {!!x.substation && <Fact first label={t("cx_substation")} value={x.substation} />}
            {!!x.subdivision && <Fact first={!x.substation} label={t("cx_subdivision")} value={x.subdivision} />}
          </Card>
        </>
      )}
    </Screen>
  );
}

function Step({ dot, line, title, time, note, last }: { dot: string; line?: string; title: string; time: string | null; note: string | null; last?: boolean }) {
  return (
    <View style={styles.step}>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        {!last && <View style={[styles.rule, { backgroundColor: line }]} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 14, gap: 1 }}>
        <Txt v="body" weight="semibold">{title}{time ? ` · ${time}` : ""}</Txt>
        {!!note && <Txt v="caption" color="muted">{note}</Txt>}
      </View>
    </View>
  );
}

function Said({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Txt v="caption" color="muted">{label}</Txt>
      <Txt v="body">{text}</Txt>
    </View>
  );
}

function Fact({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
      <Txt v="label" color="muted" style={{ flex: 1 }}>{label}</Txt>
      <Txt v="body" weight="semibold" style={{ flexShrink: 1, textAlign: "right" }}>{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  call: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40 },
  step: { flexDirection: "row", gap: 12 },
  rail: { width: 12, alignItems: "center", paddingTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rule: { width: 2, flex: 1, marginTop: 4, borderRadius: 1 },
});
