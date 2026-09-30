import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMe, useMyComplaints } from "@shared/api";
import { parseUppclDate } from "@shared/utils";
import { useI18n } from "../../src/i18n";
import { font, useColors } from "../../src/theme";
import { BackHeader, Card, Pill, Screen, Txt } from "../../src/ui";
import { Icon } from "../../src/icons";

export default function ComplaintDetail() {
  const c = useColors();
  const { t, locale } = useI18n();
  const { no, phone } = useLocalSearchParams<{ no: string; phone?: string }>();
  const { data: me } = useMe();
  const { data } = useMyComplaints(phone ?? me?.data?.[0]?.phone); // already cached by the list
  const x = data?.complaints.find((k) => k.complaint_no === no);
  const date = (d: string | null) => parseUppclDate(d)?.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) ?? null; // "30/09/2026 07:42:00 PM" (BUG-063)

  if (!x) return <Screen><BackHeader title={t("complaint_no", { no: no ?? "" })} /><Txt v="body" color="muted">{t("loading")}</Txt></Screen>;

  // Escalation chain, lowest first. Only officers UPPCL actually assigned.
  const officers = [
    { role: t("je"), name: x.je_name, phone: x.je_mobile },
    { role: t("ae"), name: x.ae_name, phone: x.ae_mobile },
    { role: t("xen"), name: x.xen_name, phone: x.xen_mobile },
  ].filter((o) => o.name || o.phone);

  const note = x.is_open ? x.remarks : x.closing_remarks || x.remarks;

  return (
    <Screen>
      <BackHeader title={t("complaint_no", { no: x.complaint_no })} />

      <Card>
        <View style={styles.head}>
          <Txt v="heading" style={{ flex: 1 }}>{x.sub_type || x.type || x.status}</Txt>
          <Pill label={x.is_open ? t("open") : t("closed")} tone={x.is_open ? "accent" : "ok"} />
        </View>
        {date(x.entry_date) && <Txt v="label" color="muted">{t("filed_on", { date: date(x.entry_date)! })}</Txt>}
        {!x.is_open && date(x.closing_date) && <Txt v="label" color="muted">{t("closed_on", { date: date(x.closing_date)! })}</Txt>}
        {note && (
          <View style={{ gap: 2, marginTop: 4 }}>
            <Txt v="caption" color="muted">{t("remarks")}</Txt>
            <Txt v="body">{note}</Txt>
          </View>
        )}
      </Card>

      {officers.length > 0 && (
        <>
          <Txt v="heading" style={{ marginTop: 8 }}>{t("handled_by")}</Txt>
          <Card style={{ padding: 0, gap: 0 }}>
            {officers.map((o, i) => (
              <View key={o.role} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt v="caption" color="muted">{o.role}</Txt>
                  <Txt v="body" weight="semibold" numberOfLines={1}>{o.name || "—"}</Txt>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60 },
  call: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minHeight: 40 },
});
