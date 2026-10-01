/**
 * "No power?" from Home. People open this already frustrated, so the common case is two taps:
 * the tile, then "Report no power". The complaint is prepared with UPPCL 1912 while the sheet opens
 * (account → substation → engineer, and whether one is already open) and filed on that one tap, for the
 * signed-in account only. Everything else (low voltage, one phase, sparking, someone else's connection, a
 * second number) is the full form, app/report.tsx, behind "Something else?".
 *
 * Filing uses 1912's own anonymous web form (no OTP for supply complaints), only on the user's tap.
 * Danger is always a call. When filing can't go through, SMS / WhatsApp / call are offered instead.
 */
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { mutate, useDowntime, useMe, useMyComplaints, useTenantPreferences, useWssConsumer, type DashboardResponse } from "@shared/api";
import { fileSupplyComplaint, HELPLINE_TEL, noPowerSmsUrl, openFor, prepareSupplyComplaint, type SupplyDraft } from "@shared/complaints";
import { ErrorNote } from "./errors";
import { useI18n } from "./i18n";
import { useColors } from "./theme";
import { Button, Insight, Sheet, Txt, familyFor, useSlow } from "./ui";
import { Icon } from "./icons";
import { openLink } from "./links";

export type Problem = "no_power" | "voltage" | "phase" | "danger";

/** The signed-in account's complaint, prepared with 1912 while `active` (substation matched from the
 *  account, a past complaint or the bill address). */
export function useOwnDraft(data: DashboardResponse | undefined, supply: Exclude<Problem, "danger"> | null, active: boolean) {
  const { data: me } = useMe();
  const { data: complaints } = useMyComplaints(me?.data?.[0]?.phone);
  const { data: consumer } = useWssConsumer();
  const cd = consumer?.ConsumerDetails;
  const [draft, setDraft] = useState<SupplyDraft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const account = data ? String(data.site.connectionId) : null;
  useEffect(() => {
    if (!active || !supply || !account) return;
    let live = true;
    setDraft(null); setError(null);
    prepareSupplyComplaint({
      account, city: cd?.premiseAddress?.city || cd?.billingAddresss?.city || null, division: cd?.division ?? null,
      substationHint: complaints?.complaints.find((x) => x.substation)?.substation ?? cd?.currentAddress ?? null,
      problem: supply === "voltage" ? "voltage" : "no_power", outage: "Individual",
    }).then((d) => live && setDraft(d), (e) => live && setError(e));
    return () => { live = false; };
  }, [active, supply, account, cd?.division, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { draft, setDraft, error, retry: () => setAttempt((n) => n + 1) };
}

/** "Complaint filed" with the number (or where it will show) and the way to track it. */
export function Filed({ complaintNo, place, onTrack }: { complaintNo: string | null; place?: string | null; onTrack: () => void }) {
  const c = useColors();
  const { t } = useI18n();
  return (
    <View style={{ gap: 12, alignItems: "center", paddingVertical: 16 }}>
      <View style={[styles.done, { backgroundColor: c.pill }]}><Icon name="checkCircle" size={44} color={c.ok} /></View>
      <Txt v="title" style={{ textAlign: "center" }}>{t("rp_filed_title")}</Txt>
      <Txt v="body" color="muted" style={{ textAlign: "center" }}>{complaintNo ? t("rp_filed_no", { no: complaintNo }) : t("rp_filed_pending")}</Txt>
      {/* What happens next, so nobody wonders whether to call too. */}
      <Txt v="label" color="muted" style={{ textAlign: "center" }}>{place ? t("rp_next_place", { place }) : t("rp_next")}</Txt>
      <Button label={t("rp_track")} onPress={onTrack} />
    </View>
  );
}

/** When in-app filing can't: the user-sent channels (SMS, the discom's WhatsApp, a call). */
export function ReportFallback({ data, problem, onDone }: { data: DashboardResponse; problem: Problem; onDone?: () => void }) {
  const { t } = useI18n();
  const { data: prefs } = useTenantPreferences();
  const waRaw = (prefs?.data?.discomDetails?.whatsappNumber || "").replace(/[^0-9]/g, "");
  const wa = waRaw ? (waRaw.length === 10 ? `91${waRaw}` : waRaw) : null;
  const account = String(data.site.connectionId), discom = String(data.site.tenantId ?? "").toUpperCase();
  return (
    <View style={{ gap: 8 }}>
      <Txt v="label" color="muted">{t("rp_other_ways")}</Txt>
      <Button label={t("rp_send_sms")} kind="soft" icon="sms" onPress={() => { void Linking.openURL(noPowerSmsUrl(data.site, Platform.OS === "ios")); onDone?.(); }} />
      {wa && <Button label={t("rp_send_wa")} kind="soft" icon="chat" onPress={() => {
        openLink(`https://wa.me/${wa}?text=${encodeURIComponent(t("rp_wa_text", { problem: t(`rp_${problem}`), account, discom }))}`); onDone?.();
      }} />}
      <Button label={t("rp_call_1912")} kind="soft" icon="call" onPress={() => { void Linking.openURL(`tel:${HELPLINE_TEL}`); onDone?.(); }} />
    </View>
  );
}

export function ReportSheet({ data, visible, onClose }: { data: DashboardResponse; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { t, span, lang } = useI18n();
  const { data: me } = useMe();
  const { data: complaints } = useMyComplaints(me?.data?.[0]?.phone);
  const { data: downtime } = useDowntime();
  const open = complaints?.complaints.find((x) => x.is_open);
  const planned = downtime?.data?.body || downtime?.data?.title;
  const { draft, error: prepError, retry } = useOwnDraft(data, "no_power", visible); // prepared as the sheet opens
  const slow = useSlow(visible && !draft && !prepError); // 1912 can hang: don't leave people waiting on "Getting ready…"
  const [extra, setExtra] = useState(""); // optional words added to the automatic note
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<{ ok: boolean; complaintNo: string | null; message: string } | null>(null);
  const [fileError, setFileError] = useState<unknown>(null);

  const close = () => { setExtra(""); setFiled(null); setFileError(null); onClose(); };
  const full = () => { close(); router.push("/report"); };
  async function file() {
    if (!draft) return;
    const time = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const note = t("rp_note_no_power", { time }) + (extra.trim() ? ` ${extra.trim()}` : "");
    setBusy(true); setFileError(null);
    try {
      setFiled(await fileSupplyComplaint({ ...draft, controls: { ...draft.controls, 95303: "Individual" } }, note));
      void mutate((k) => typeof k === "string" && k.startsWith("/complaints")); // shows up in Complaints / Home
    } catch (e) { setFileError(e); } finally { setBusy(false); }
  }
  const failed = !!prepError || !!fileError || !!draft?.blocked || (!!filed && !filed.ok);
  const link = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Txt v="label" color="primary" weight="semibold">{label}</Txt>
    </Pressable>
  );

  return (
    <Sheet visible={visible} onClose={close} title={filed?.ok ? t("rp_title") : t("rp_title_quick")}>
      {filed?.ok ? (
        <Filed complaintNo={filed.complaintNo} place={draft?.substation} onTrack={() => { close(); router.push("/complaints"); }} />
      ) : (
        <>
          {/* An open complaint or a planned cut: say so first, filing again won't speed it up. */}
          {!!planned && <Insight tone="warn" icon="event" text={t("rp_planned", { notice: String(planned).trim() })} />}
          {!!open && (
            <Pressable accessibilityRole="button" onPress={() => { close(); router.push({ pathname: "/complaint/[no]", params: { no: open.complaint_no } }); }}>
              <Insight tone="accent" icon="supportAgent"
                text={t("rp_already_open", { type: open.sub_type || open.type || "", t: openFor(open) !== null ? span(openFor(open)!) : "" })} />
            </Pressable>
          )}
          {!failed && (
            <>
              {/* Where it goes, once, above the action (not a wall of text under it). */}
              <View style={styles.where}>
                <Icon name="home" size={16} color={c.muted} />
                <Txt v="caption" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {draft?.substation ? t("rp_sheet_where", { place: draft.substation }) : t("rp_getting_ready")}
                </Txt>
              </View>
              {/* Optional and already open: typing is never an extra step, skipping it costs nothing. */}
              <TextInput value={extra} onChangeText={(x) => setExtra(x.slice(0, 150))} multiline
                placeholder={t("rp_extra_ph")} placeholderTextColor={c.muted} accessibilityLabel={t("rp_extra_ph")}
                style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.line, fontFamily: familyFor("medium", lang === "hi") }]} />
              <Button label={busy ? t("rp_filing") : !draft ? t("rp_getting_ready") : t("rp_quick")} icon="bolt" busy={busy || !draft}
                onPress={() => (draft && !draft.substation ? full() : void file())} />
            </>
          )}
          {!!draft?.blocked && <Insight tone="warn" text={t("rp_blocked", { msg: draft.blocked })} />}
          {filed && !filed.ok && <Insight tone="warn" text={t("rp_file_refused", { msg: filed.message || "—" })} />}
          {slow && <Insight tone="warn" icon="schedule" text={t("rp_slow")} />}
          {slow && <ReportFallback data={data} problem="no_power" onDone={close} />}
          {!!prepError && <ErrorNote error={prepError} onRetry={retry} />}
          {!!fileError && <ErrorNote error={fileError} onRetry={() => void file()} />}
          {/* 1912 couldn't place the account (e.g. the bill's city isn't a 1912 district): the full form lets them pick. */}
          {!!prepError && link(t("rp_pick_district_me"), full)}
          {failed && <ReportFallback data={data} problem="no_power" onDone={close} />}
          {link(t("rp_something_else"), full)}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 36, justifyContent: "center", alignSelf: "center", marginTop: -6, marginBottom: -8 },
  where: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4 },
  done: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  input: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 12, minHeight: 104, fontSize: 16, textAlignVertical: "top" },
});
