/**
 * "No power?" from Home. People open this already frustrated, so the common case is two taps:
 * the tile, then "Report no power". The complaint is prepared with UPPCL 1912 while the sheet opens
 * (account → substation → engineer, and whether one is already open) and filed on that one tap.
 * Everything else (low voltage, one phase, sparking, writing a note) is behind "Something else?".
 *
 * Filing uses 1912's own anonymous web form (no OTP for supply complaints), only on the user's tap.
 * Danger is always a call. When filing can't go through, SMS / WhatsApp / call are offered instead.
 */
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { mutate, useDowntime, useMe, useMyComplaints, useTenantPreferences, useWssConsumer, type DashboardResponse } from "@shared/api";
import { chooseSubstation, fileSupplyComplaint, openFor, prepareSupplyComplaint, type SupplyDraft } from "@shared/complaints";
import { HELPLINE_TEL, noPowerSmsUrl } from "@shared/outage";
import { ErrorNote } from "./errors";
import { useI18n } from "./i18n";
import { useColors } from "./theme";
import { Button, Choices, Insight, Segmented, Sheet, Txt, familyFor } from "./ui";
import { Icon, type IconName } from "./icons";
import { openLink } from "./links";

type Problem = "no_power" | "voltage" | "phase" | "danger";
const OTHER: { id: Problem; icon: IconName }[] = [
  { id: "voltage", icon: "trendingUp" },
  { id: "phase", icon: "home" },
  { id: "no_power", icon: "bolt" }, // "No power, and I want to add details"
  { id: "danger", icon: "warning" },
];
type View_ = "quick" | "other" | "detail";
type Filed = { ok: boolean; complaintNo: string | null; message: string };

export function ReportSheet({ data, visible, onClose }: { data: DashboardResponse; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { t, span, lang } = useI18n();
  const [view, setView] = useState<View_>("quick");
  const [problem, setProblem] = useState<Problem>("no_power");
  const { data: me } = useMe();
  const { data: complaints } = useMyComplaints(me?.data?.[0]?.phone);
  const { data: downtime } = useDowntime();
  const { data: prefs } = useTenantPreferences();
  const { data: consumer } = useWssConsumer();
  const cd = consumer?.ConsumerDetails;
  const open = complaints?.complaints.find((x) => x.is_open);
  const planned = downtime?.data?.body || downtime?.data?.title;
  const waRaw = (prefs?.data?.discomDetails?.whatsappNumber || "").replace(/[^0-9]/g, "");
  const wa = waRaw ? (waRaw.length === 10 ? `91${waRaw}` : waRaw) : null;
  const account = String(data.site.connectionId);
  const discom = String(data.site.tenantId ?? "").toUpperCase();

  const supply = problem === "danger" ? null : problem;
  const [outage, setOutage] = useState<"Individual" | "Area">("Individual");
  const [draft, setDraft] = useState<SupplyDraft | null>(null);
  const [prepError, setPrepError] = useState<unknown>(null);
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState(""); // quick view: optional words added to the automatic note
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<Filed | null>(null);
  const [fileError, setFileError] = useState<unknown>(null);
  const now = () => new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  // Prepare as soon as the sheet opens, so the one tap files straight away.
  useEffect(() => {
    if (!visible || !supply) return;
    let live = true;
    setDraft(null); setPrepError(null);
    setNote(t(`rp_note_${supply}`, { time: now() }));
    // Substation: from the account, else matched from the address or a past complaint's substation.
    const hint = complaints?.complaints.find((x) => x.substation)?.substation ?? cd?.currentAddress ?? null;
    prepareSupplyComplaint({
      account, city: cd?.premiseAddress?.city || cd?.billingAddresss?.city || null, division: cd?.division ?? null,
      substationHint: hint, problem: supply === "voltage" ? "voltage" : "no_power", outage,
    }).then((d) => live && setDraft(d), (e) => live && setPrepError(e));
    return () => { live = false; };
  }, [visible, supply, outage, account, cd?.division]); // eslint-disable-line react-hooks/exhaustive-deps

  async function file(remarks: string) {
    if (!draft) return;
    setBusy(true); setFileError(null);
    try {
      setFiled(await fileSupplyComplaint(draft, remarks));
      void mutate((k) => typeof k === "string" && k.startsWith("/complaints")); // shows up in Complaints / Home
    } catch (e) { setFileError(e); } finally { setBusy(false); }
  }
  async function pick(id: string) {
    if (!draft) return;
    setBusy(true); setPrepError(null);
    try { setDraft(await chooseSubstation(draft, id)); } catch (e) { setPrepError(e); } finally { setBusy(false); }
  }

  const close = () => { setExtra(""); setView("quick"); setProblem("no_power"); setFiled(null); setFileError(null); setOutage("Individual"); onClose(); };
  const call = () => { void Linking.openURL(`tel:${HELPLINE_TEL}`); close(); };
  const sms = () => { void Linking.openURL(noPowerSmsUrl(data.site, Platform.OS === "ios")); close(); };
  const whatsapp = () => {
    openLink(`https://wa.me/${wa}?text=${encodeURIComponent(t("rp_wa_text", { problem: t(`rp_${problem}`), account, discom }))}`);
    close();
  };
  const needsSubstation = !!draft && !draft.substation;
  const failed = !!prepError || !!fileError || !!draft?.blocked;
  const where = draft?.substation ? t("rp_goes_to", { place: draft.substation }) : null;

  // When in-app filing can't: the user-sent channels.
  const fallback = (
    <View style={{ gap: 8 }}>
      <Txt v="label" color="muted">{t("rp_other_ways")}</Txt>
      <Button label={t("rp_send_sms")} kind="soft" icon="sms" onPress={sms} />
      {wa && <Button label={t("rp_send_wa")} kind="soft" icon="chat" onPress={whatsapp} />}
      <Button label={t("rp_call_1912")} kind="soft" icon="call" onPress={call} />
    </View>
  );
  const problems = (
    <>
      {failed && (draft?.blocked ? <Insight tone="warn" text={t("rp_blocked", { msg: draft.blocked })} /> : <ErrorNote error={prepError ?? fileError} compact />)}
      {failed && fallback}
    </>
  );
  const link = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Txt v="label" color="primary" weight="semibold">{label}</Txt>
    </Pressable>
  );

  let body;
  if (filed?.ok) {
    body = (
      <View style={{ gap: 12, alignItems: "center", paddingVertical: 8 }}>
        <Icon name="checkCircle" size={48} color={c.ok} />
        <Txt v="heading" style={{ textAlign: "center" }}>{t("rp_filed_title")}</Txt>
        <Txt v="body" color="muted" style={{ textAlign: "center" }}>
          {filed.complaintNo ? t("rp_filed_no", { no: filed.complaintNo }) : t("rp_filed_pending")}
        </Txt>
        <Button label={t("rp_track")} onPress={() => { close(); router.push("/complaints"); }} />
      </View>
    );
  } else if (filed) {
    body = <><Insight tone="warn" text={t("rp_file_refused", { msg: filed.message || "—" })} />{fallback}</>;
  } else if (view === "quick") {
    body = (
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
            {/* Optional and already open: typing is never an extra step, skipping it costs nothing. */}
            <TextInput value={extra} onChangeText={(x) => setExtra(x.slice(0, 150))} multiline
              placeholder={t("rp_extra_ph")} placeholderTextColor={c.muted} accessibilityLabel={t("rp_extra_ph")}
              style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.line, fontFamily: familyFor("medium", lang === "hi") }]} />
            <Button label={busy ? t("rp_filing") : !draft ? t("rp_getting_ready") : t("rp_quick")} icon="bolt" busy={busy || (!draft && !prepError)}
              onPress={() => {
                const remarks = extra.trim() ? `${note} ${extra.trim()}` : note;
                if (needsSubstation) { setNote(remarks); setView("detail"); } else void file(remarks);
              }} />
            <Txt v="caption" color="muted" style={{ textAlign: "center" }}>{where ? `${t("rp_quick_note")} · ${where}` : t("rp_quick_note")}</Txt>
          </>
        )}
        {problems}
        {link(t("rp_something_else"), () => setView("other"))}
      </>
    );
  } else if (view === "other") {
    body = (
      <>
        <View style={[styles.list, { borderColor: c.line }]}>
          {OTHER.map((p, i) => (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => { setProblem(p.id); setView("detail"); }}
              style={({ pressed }) => [styles.option, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
              <View style={[styles.icon, { backgroundColor: p.id === "danger" ? c.criticalSoft : c.pill }]}>
                <Icon name={p.icon} size={20} color={p.id === "danger" ? c.critical : c.pillText} />
              </View>
              <Txt v="body" weight="semibold" style={{ flex: 1 }} color={p.id === "danger" ? "critical" : undefined}>
                {p.id === "no_power" ? t("rp_no_power_details") : t(`rp_${p.id}`)}
              </Txt>
              <Icon name="chevronRight" size={20} color={c.muted} />
            </Pressable>
          ))}
        </View>
        {link(t("rp_back"), () => { setProblem("no_power"); setView("quick"); })}
      </>
    );
  } else if (problem === "danger") {
    body = (
      <>
        {/* Safety first: a live wire is not a form. */}
        <Txt v="body">{t("rp_danger_body")}</Txt>
        <Button label={t("rp_call_1912")} icon="call" onPress={call} />
        {link(t("rp_back"), () => setView("other"))}
      </>
    );
  } else {
    body = (
      <>
        {/* 1912 hasn't recorded every account's substation: then the user picks it, once. */}
        {needsSubstation && draft!.substations.length > 0 && (
          <>
            <Txt v="label" color="muted">{t("rp_pick_substation")}</Txt>
            <Choices value="" onChange={(id) => void pick(id)} options={draft!.substations.map((x) => ({ value: x.id, label: x.name }))} />
          </>
        )}
        {supply !== "voltage" && ( // 1912 asks this for no supply only
          <Segmented<"Individual" | "Area"> value={outage} onChange={setOutage}
            options={[{ value: "Individual", label: t("rp_just_me") }, { value: "Area", label: t("rp_area") }]} />
        )}
        <TextInput value={note} onChangeText={(x) => setNote(x.slice(0, 200))} multiline accessibilityLabel={t("rp_note_label")}
          style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.line, fontFamily: familyFor("medium", lang === "hi") }]} />
        {!failed && (
          <>
            <Button label={busy ? t("rp_filing") : t("rp_file")} icon="supportAgent" busy={busy || (!draft && !prepError)}
              disabled={needsSubstation || !note.trim()} onPress={() => void file(note)} />
            {!!where && <Txt v="caption" color="muted" style={{ textAlign: "center" }}>{where}</Txt>}
          </>
        )}
        {problems}
        {link(t("rp_back"), () => setView("other"))}
      </>
    );
  }

  return (
    <Sheet visible={visible} onClose={close}
      title={filed ? t("rp_title") : view === "quick" ? t("rp_title_quick") : view === "detail" ? t(`rp_${problem}`) : t("rp_title")}>
      {body}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "center" },
  input: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56, fontSize: 16, textAlignVertical: "top" },
});
