import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMe, useMyComplaints } from "@shared/api";
import { openFor, sourceKind } from "@shared/complaints";
import { parseUppclDate } from "@shared/utils";
import { useI18n } from "../../src/i18n";
import { useColors } from "../../src/theme";
import { BackHeader, Card, Pill, Screen, Skeleton, SkeletonRows, SlowNote, Txt } from "../../src/ui";
import { Icon } from "../../src/icons";

export default function ComplaintDetail() {
  const c = useColors();
  const { t, locale, span } = useI18n();
  const { no, phone } = useLocalSearchParams<{ no: string; phone?: string }>();
  const { data: me } = useMe();
  const { data } = useMyComplaints(phone ?? me?.data?.[0]?.phone); // already cached by the list
  const x = data?.complaints.find((k) => k.complaint_no === no);
  // "30/09/2026 07:42:00 PM" (BUG-063): with the time, since how long a fix took is the point here.
  const when = (d: string | null) => parseUppclDate(d)?.toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) ?? null;

  if (!x) return (
    <Screen>
      <BackHeader title={t("complaint_no", { no: no ?? "" })} />
      <Card><Skeleton w="50%" h={20} /><Skeleton w="70%" h={14} /><Skeleton w="60%" h={14} /></Card>
      <Card style={{ padding: 0, gap: 0 }}><SkeletonRows n={3} /></Card>
      <SlowNote loading />
    </Screen>
  );

  const took = openFor(x);
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
      <BackHeader title={t("complaint_no", { no: x.complaint_no })} />

      <Card>
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="heading">{x.sub_type || x.type || x.status}</Txt>
            {!!x.type && x.type !== x.sub_type && <Txt v="caption" color="muted">{x.type}</Txt>}
          </View>
          <Pill label={x.is_open ? t("open") : t("closed")} tone={x.is_open ? "accent" : "ok"} />
        </View>

        {/* Filed → closed, with how long it took: the one number people care about after a power cut. */}
        <View style={{ gap: 0, marginTop: 4 }}>
          <Step dot={c.primary} line={c.line} title={t("cx_filed")} time={when(x.entry_date)} note={src ? t("cx_via", { src: t(`cx_src_${src}`) }) : null} />
          <Step dot={x.is_open ? c.warn : c.ok} last title={x.is_open ? t("cx_still_open") : t("cx_closed")}
            time={x.is_open ? null : when(x.closing_date)}
            note={took !== null ? t(x.is_open ? "cx_so_far" : "cx_took", { t: span(took) }) : null} />
        </View>
      </Card>

      {(!!x.remarks || !!closingNote) && (
        <Card>
          {!!x.remarks && <Said label={t("cx_you_said")} text={x.remarks} />}
          {!!closingNote && <Said label={t("cx_uppcl_did")} text={closingNote} />}
        </Card>
      )}

      {officers.length > 0 && (
        <>
          <View style={{ marginTop: 8, gap: 2 }}>
            <Txt v="heading">{t("handled_by")}</Txt>
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
                  <Pressable accessibilityRole="button" accessibilityLabel={`${t("call")} ${o.name ?? o.role}`}
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
