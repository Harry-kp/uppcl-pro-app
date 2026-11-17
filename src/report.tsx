/**
 * "No power?" from Home. People open this already frustrated, so the common case is two taps:
 * the tile, then "Report no power". The complaint is prepared with UPPCL 1912 while the sheet opens
 * (account → substation → engineer, and whether one is already open) and filed on that one tap, for the
 * signed-in account only. Everything else (low voltage, one phase, sparking, someone else's connection, a
 * second number) is the full form, app/report.tsx, behind "Something else?".
 *
 * Filing goes through 1912's signed-in "Register Complaint" (OTP sign-in, and the connection added to that
 * number on 1912 once; cantFileKey says which is missing). Only ever on the user's tap.
 * Danger is always a call. When filing can't go through, SMS / WhatsApp / call are offered instead.
 */
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { mutate, useAreaOutage, useDowntime, useMe, useMyComplaints, useTenantPreferences, useWssConsumer, type DashboardResponse } from "@shared/api";
import { fileSupplyComplaint, HELPLINE_TEL, is1912FilingPaused, is1912LoginOnly, is1912NotLinked, noPowerSmsUrl, openFor, prepareSupplyComplaint, type SupplyDraft } from "@shared/complaints";
import { Connect1912Sheet } from "./connect1912";
import { ErrorNote } from "./errors";
import { useI18n } from "./i18n";
import { useColors } from "./theme";
import { Button, Insight, Sheet, Txt, useSlow, Field } from "./ui";
import { Icon } from "./icons";
import { openLink } from "./links";

export type Problem = "no_power" | "voltage" | "phase" | "danger";

/** The signed-in account's complaint, prepared with 1912 while `active` (substation matched from the
 *  account, a past complaint or the bill address). */
export function useOwnDraft(data: DashboardResponse | undefined, supply: Exclude<Problem, "danger"> | null, active: boolean) {
  const [draft, setDraft] = useState<SupplyDraft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const account = data ? String(data.site.connectionId) : null;
  useEffect(() => {
    if (!active || !supply || !account) return;
    let live = true;
    setDraft(null); setError(null);
    prepareSupplyComplaint({ account, problem: supply === "voltage" ? "voltage" : "no_power", outage: "Individual" })
      .then((d) => live && setDraft(d), (e) => live && setError(e));
    return () => { live = false; };
  }, [active, supply, account, attempt]);
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
/** Why the app can't file at all (the user-sent channels are then the only way), as a message key; null = a real error. */
export function cantFileKey(e: unknown): "rp_filing_paused" | "rp_1912_login" | "rp_1912_link" | null {
  return !e ? null : is1912FilingPaused(e) ? "rp_filing_paused" : is1912LoginOnly(e) ? "rp_1912_login" : is1912NotLinked(e) ? "rp_1912_link" : null;
}

/**
 * The user-sent channels. `only`: the app can't file at all, so these ARE the way (no "other ways" caption,
 * the first is primary). `account`: someone else's connection (their number in the texts, no discom guessed).
 * The SMS keyword is "NO POWER", so it's offered for no power only; voltage / one phase is WhatsApp or a call.
 */
export function ReportFallback({ data, problem, onDone, only, account }: {
  data: DashboardResponse; problem: Problem; onDone?: () => void; only?: boolean; account?: string;
}) {
  const { t } = useI18n();
  const { data: prefs } = useTenantPreferences();
  const waRaw = (prefs?.data?.discomDetails?.whatsappNumber || "").replace(/[^0-9]/g, "");
  const wa = waRaw ? (waRaw.length === 10 ? `91${waRaw}` : waRaw) : null;
  const site = account ? { connectionId: account } : { connectionId: String(data.site.connectionId), tenantId: data.site.tenantId };
  const discom = String(site.tenantId ?? "").toUpperCase();
  const sms = problem === "no_power";
  const kind = (first: boolean) => (only && first ? undefined : "soft" as const);
  return (
    <View style={{ gap: 8 }}>
      {!only && <Txt v="label" color="muted">{t("rp_other_ways")}</Txt>}
      {sms && <Button label={t("rp_send_sms")} kind={kind(true)} icon="sms" onPress={() => { void Linking.openURL(noPowerSmsUrl(site, Platform.OS === "ios")); onDone?.(); }} />}
      {wa && <Button label={t("rp_send_wa")} kind={kind(!sms)} icon="chat" onPress={() => {
        openLink(`https://wa.me/${wa}?text=${encodeURIComponent(t(discom ? "rp_wa_text" : "rp_wa_text_other", { problem: t(`rp_${problem}`), account: site.connectionId, discom }))}`); onDone?.();
      }} />}
      <Button label={t("rp_call_1912")} kind={kind(!sms && !wa)} icon="call" onPress={() => { void Linking.openURL(`tel:${HELPLINE_TEL}`); onDone?.(); }} />
    </View>
  );
}

export function ReportSheet({ data, visible, onClose }: { data: DashboardResponse; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { t, span } = useI18n();
  const { data: me } = useMe();
  const { data: complaints } = useMyComplaints();
  const { data: downtime } = useDowntime();
  const open = complaints?.complaints.find((x) => x.is_open);
  const planned = downtime?.data?.body || downtime?.data?.title;
  const { draft, error: prepError, retry } = useOwnDraft(data, "no_power", visible); // prepared as the sheet opens
  const [connect, setConnect] = useState(false);
  const slow = useSlow(visible && !draft && !prepError); // 1912 can hang: don't leave people waiting on "Getting ready…"
  const [extra, setExtra] = useState(""); // optional words added to the automatic note
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<{ ok: boolean; complaintNo: string | null; message: string } | null>(null);
  const [fileError, setFileError] = useState<unknown>(null);
  const [again, setAgain] = useState(false); // open complaint: filing another is a deliberate extra tap (UX-R01)

  const close = () => { setExtra(""); setFiled(null); setFileError(null); setAgain(false); onClose(); };
  const seeOpen = () => { if (!open) return; close(); router.push({ pathname: "/complaint/[no]", params: { no: open.complaint_no } }); };
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
  const holdForOpen = !!open && !again;

  return (
    <Sheet visible={visible} onClose={close} title={filed?.ok ? t("rp_title") : t("rp_title_quick")}>
      {filed?.ok ? (
        <Filed complaintNo={filed.complaintNo} place={draft?.substation} onTrack={() => { close(); router.push("/complaints"); }} />
      ) : (
        <>
          {/* An open complaint or a planned cut: say so first, filing again won't speed it up. */}
          {!!planned && <Insight tone="warn" icon="event" text={t("rp_planned", { notice: String(planned).trim() })} />}
          <AreaOutageNote />
          {!!open && (
            <Insight tone="warn" icon="supportAgent"
              text={t("rp_already_open", { type: open.sub_type || open.type || "", t: openFor(open) !== null ? span(openFor(open)!) : "" })} />
          )}
          {/* The open complaint IS the action: its page has the engineers to call, in order. */}
          {holdForOpen && <Button label={t("rp_see_open")} icon="supportAgent" onPress={seeOpen} />}
          {holdForOpen && <TextLink label={t("rp_report_again")} onPress={() => setAgain(true)} />}
          {!holdForOpen && !failed && (
            <>
              {/* Where it goes, once, above the action (not a wall of text under it). */}
              <View style={styles.where}>
                <Icon name="home" size={16} color={c.muted} />
                <Txt v="caption" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {draft?.substation ? t("rp_sheet_where", { place: draft.substation }) : t("rp_getting_ready")}
                </Txt>
              </View>
              {/* Optional and already open: typing is never an extra step, skipping it costs nothing. */}
              <Field value={extra} onChangeText={setExtra} limit={150} multiline
                placeholder={t("rp_extra_ph")} accessibilityLabel={t("rp_extra_ph")}
                style={styles.input} />
              <Button label={busy ? t("rp_filing") : !draft ? t("rp_getting_ready") : t("rp_quick")} icon="bolt" busy={busy || !draft}
                onPress={() => (draft && !draft.substation ? full() : void file())} />
            </>
          )}
          {!holdForOpen && (
            <>
              {!!draft?.blocked && <Insight tone="warn" text={t("rp_blocked", { msg: draft.blocked })} />}
              {filed && !filed.ok && <Insight tone="warn" text={t("rp_file_refused", { msg: filed.message || "—" })} />}
              {slow && !failed && <Insight tone="warn" icon="schedule" text={t("rp_slow")} />}
              {slow && !failed && <ReportFallback data={data} problem="no_power" onDone={close} />}
              {/* 1912 is OTP-login-only now: say it plainly, no "UPPCL is having a problem" + retry that can't work. */}
              {!!prepError && (cantFileKey(prepError) ? <Insight tone="accent" icon="info" text={t(cantFileKey(prepError)!)} /> : <ErrorNote error={prepError} onRetry={retry} />)}
              {!!fileError && <ErrorNote error={fileError} onRetry={() => void file()} />}
              {/* Can't file from here (not connected, offline, refused): the SMS works right now, so it is THE button (UX-R13). */}
              {failed && <ReportFallback data={data} problem="no_power" onDone={close} only />}
              {/* Not signed in to 1912 (or it expired): connecting is for next time, so it's a link under the way that works now. */}
              {cantFileKey(prepError) === "rp_1912_login" && <TextLink label={t("c19_connect_next")} onPress={() => setConnect(true)} />}
            </>
          )}
          <Connect1912Sheet visible={connect} onClose={() => setConnect(false)} onDone={retry} />
          <TextLink label={t("rp_something_else")} onPress={full} />
          <DangerRow />
        </>
      )}
    </Sheet>
  );
}

/** UPPCL has logged an outage on the user's line (1912 "Outage Information"): say what and since when, so nobody
 *  wonders whether it's just their house. Shown only when 1912 lists one. */
export function AreaOutageNote() {
  const { t } = useI18n();
  const { data } = useAreaOutage();
  const o = data?.[0];
  if (!o) return null;
  const where = o.feeder ?? o.substation;
  const when = o.from && o.to ? t("outage_when", { from: o.from, to: o.to }) : o.from ? t("outage_since", { from: o.from }) : "";
  return <Insight tone="warn" icon="event" text={[t(where ? "outage_on" : "outage_on_line", { where: where ?? "" }), when, o.info].filter(Boolean).join(" · ")} />;
}

/** A centred text action, 48 dp tall (UX-R23). */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Txt v="label" color="primary" weight="semibold" style={{ textAlign: "center" }}>{label}</Txt>
    </Pressable>
  );
}

/** Danger is a call, not a complaint: one red row wherever power problems are (UX-R33). */
export function DangerRow() {
  const c = useColors();
  const { t } = useI18n();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${t("rp_danger_row")}. ${t("rp_danger_row_sub")}`}
      onPress={() => void Linking.openURL(`tel:${HELPLINE_TEL}`)}
      style={({ pressed }) => [styles.danger, { backgroundColor: pressed ? c.criticalSoft : c.surface, borderColor: c.line }]}>
      <View style={[styles.dangerIcon, { backgroundColor: c.criticalSoft }]}><Icon name="warning" size={20} color={c.critical} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="body" weight="semibold" color="critical">{t("rp_danger_row")}</Txt>
        <Txt v="caption" color="muted">{t("rp_danger_row_sub")}</Txt>
      </View>
      <Icon name="call" size={20} color={c.critical} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 48, paddingHorizontal: 12, justifyContent: "center", alignSelf: "center" },
  danger: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  dangerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  where: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4 },
  done: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 104 },
});
