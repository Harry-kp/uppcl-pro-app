/**
 * "No power?" from Home: one question, then UPPCL's own channel with everything pre-filled.
 * The app never files a complaint itself — the SMS / WhatsApp / call is sent by the user, from their phone.
 *
 * What a complaint needs (checked against what UPPCL's 1912 records hold): the account number and discom
 * (we have them), and what's wrong. Name, address, substation and engineer UPPCL fills in from the account.
 */
import { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useDowntime, useMe, useMyComplaints, useTenantPreferences, type DashboardResponse } from "@shared/api";
import { openFor } from "@shared/complaints";
import { COMPLAINT_SMS_NUMBER, HELPLINE_TEL, noPowerSmsUrl } from "@shared/outage";
import { useI18n } from "./i18n";
import { useColors } from "./theme";
import { Button, Insight, Sheet, Txt } from "./ui";
import { Icon, type IconName } from "./icons";
import { openLink } from "./links";

type Problem = "no_power" | "voltage" | "phase" | "danger";
const PROBLEMS: { id: Problem; icon: IconName }[] = [
  { id: "no_power", icon: "bolt" },
  { id: "voltage", icon: "trendingUp" },
  { id: "phase", icon: "home" },
  { id: "danger", icon: "warning" },
];

export function ReportSheet({ data, visible, onClose }: { data: DashboardResponse; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { t, span } = useI18n();
  const [problem, setProblem] = useState<Problem | null>(null);
  const { data: me } = useMe();
  const { data: complaints } = useMyComplaints(me?.data?.[0]?.phone);
  const { data: downtime } = useDowntime();
  const { data: prefs } = useTenantPreferences();
  const open = complaints?.complaints.find((x) => x.is_open);
  const planned = downtime?.data?.body || downtime?.data?.title;
  const waRaw = (prefs?.data?.discomDetails?.whatsappNumber || "").replace(/[^0-9]/g, "");
  const wa = waRaw ? (waRaw.length === 10 ? `91${waRaw}` : waRaw) : null;
  const account = String(data.site.connectionId);
  const discom = String(data.site.tenantId ?? "").toUpperCase();

  const close = () => { setProblem(null); onClose(); };
  const call = () => { void Linking.openURL(`tel:${HELPLINE_TEL}`); close(); };
  const sms = () => { void Linking.openURL(noPowerSmsUrl(data.site, Platform.OS === "ios")); close(); };
  const whatsapp = () => {
    const text = t("rp_wa_text", { problem: t(`rp_${problem ?? "no_power"}`), account, discom });
    openLink(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`);
    close();
  };

  return (
    <Sheet visible={visible} title={t("rp_title")} onClose={close}>
      {/* Check first: a planned cut or an open complaint means a new complaint won't speed anything up. */}
      {!!planned && <Insight tone="warn" icon="event" text={t("rp_planned", { notice: String(planned).trim() })} />}
      {!!open && (
        <Pressable accessibilityRole="button" onPress={() => { close(); router.push({ pathname: "/complaint/[no]", params: { no: open.complaint_no } }); }}>
          <Insight tone="accent" icon="supportAgent"
            text={t("rp_already_open", { type: open.sub_type || open.type || "", t: openFor(open) !== null ? span(openFor(open)!) : "" })} />
        </Pressable>
      )}

      {!problem ? (
        <>
          <Txt v="label" color="muted">{t("rp_question")}</Txt>
          <View style={[styles.list, { borderColor: c.line }]}>
            {PROBLEMS.map((p, i) => (
              <Pressable key={p.id} accessibilityRole="button" onPress={() => setProblem(p.id)}
                style={({ pressed }) => [styles.option, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
                <View style={[styles.icon, { backgroundColor: p.id === "danger" ? c.accentSoft : c.pill }]}>
                  <Icon name={p.icon} size={20} color={p.id === "danger" ? c.critical : c.pillText} />
                </View>
                <Txt v="body" weight="semibold" style={{ flex: 1 }} color={p.id === "danger" ? "critical" : undefined}>{t(`rp_${p.id}`)}</Txt>
                <Icon name="chevronRight" size={20} color={c.muted} />
              </Pressable>
            ))}
          </View>
        </>
      ) : problem === "danger" ? (
        <>
          {/* Safety first: a live wire is not an SMS. */}
          <Txt v="body">{t("rp_danger_body")}</Txt>
          <Button label={t("rp_call_1912")} icon="call" onPress={call} />
        </>
      ) : (
        <>
          <Txt v="label" color="muted">{t("rp_sends")}</Txt>
          <View style={[styles.summary, { backgroundColor: c.bg, borderColor: c.line }]}>
            <Txt v="body" weight="semibold">{t(`rp_${problem}`)}</Txt>
            <Txt v="caption" color="muted" numeric>{t("rp_account_line", { account, discom })}</Txt>
          </View>
          {problem === "no_power" ? (
            <>
              <Button label={t("rp_send_sms")} icon="sms" onPress={sms} />
              <Txt v="caption" color="muted">{t("rp_sms_note", { n: COMPLAINT_SMS_NUMBER })}</Txt>
            </>
          ) : wa ? (
            <Button label={t("rp_send_wa")} icon="chat" onPress={whatsapp} />
          ) : null}
          <Button label={t("rp_call_1912")} kind="soft" icon="call" onPress={call} />
          <Pressable accessibilityRole="button" onPress={() => setProblem(null)} style={styles.back}>
            <Txt v="label" color="primary" weight="semibold">{t("rp_change")}</Txt>
          </Pressable>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  summary: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 2 },
  back: { minHeight: 44, justifyContent: "center", alignSelf: "center" },
});
