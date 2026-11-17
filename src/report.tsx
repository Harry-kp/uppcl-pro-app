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
import { useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { mutate, useAreaOutage, useDashboard, useDowntime, useMe, useMyComplaints, usePlannedCuts, useSeenComplaintDetail, useTenantPreferences, useWssConsumer, type DashboardResponse } from "@shared/api";
import { cityOf, myPlannedCuts, type MyCut } from "@shared/plannedCuts";
import { fileSupplyComplaint, HELPLINE_TEL, HELPLINE_TOLL_FREE, LINK_ACCOUNT_URL, latestPlannedCutPdf, PVVNL_HOME, is1912FilingPaused, is1912LoginOnly, is1912NotLinked, noPowerSmsUrl, openFor, prepareSupplyComplaint, type SupplyDraft } from "@shared/complaints";
import { platform } from "@shared/platform";
import { Connect1912Sheet } from "./connect1912";
import { ErrorNote } from "./errors";
import { useI18n } from "./i18n";
import { useColors } from "./theme";
import { animateNext, Button, Insight, Sheet, Txt, useSlow, Field } from "./ui";
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
export function ReportFallback({ data, problem, onDone, only, account, lean }: {
  data: DashboardResponse; problem: Problem; onDone?: () => void; only?: boolean; account?: string;
  /** No-power sheet: SMS + call only; WhatsApp and toll-free live under its "More options". */
  lean?: boolean;
}) {
  const { t } = useI18n();
  const wa = useWhatsAppUrl(data, problem, account);
  const site = account ? { connectionId: account } : { connectionId: String(data.site.connectionId), tenantId: data.site.tenantId };
  const sms = problem === "no_power";
  const kind = (first: boolean) => (only && first ? undefined : "soft" as const);
  const showWa = !!wa && !(lean && sms);
  return (
    <View style={{ gap: 8 }}>
      {!only && !lean && <Txt v="label" color="muted">{t("rp_other_ways")}</Txt>}
      {sms && <Button label={t("rp_send_sms")} kind={kind(true)} icon="sms" onPress={() => { void Linking.openURL(noPowerSmsUrl(site, Platform.OS === "ios")); onDone?.(); }} />}
      {showWa && <Button label={t("rp_send_wa")} kind={kind(!sms)} icon="chat" onPress={() => { openLink(wa!); onDone?.(); }} />}
      <Button label={t("rp_call_1912")} kind={kind(!sms && !showWa)} icon="call" onPress={() => { void Linking.openURL(`tel:${HELPLINE_TEL}`); onDone?.(); }} />
      {!lean && <TollFreeLink />}
    </View>
  );
}

/** The discom's WhatsApp complaint link with the message filled in, or null when the discom has none. */
function useWhatsAppUrl(data: DashboardResponse, problem: Problem, account?: string): string | null {
  const { t } = useI18n();
  const { data: prefs } = useTenantPreferences();
  const raw = (prefs?.data?.discomDetails?.whatsappNumber || "").replace(/[^0-9]/g, "");
  if (!raw) return null;
  const discom = account ? "" : String(data.site.tenantId ?? "").toUpperCase();
  const text = t(discom ? "rp_wa_text" : "rp_wa_text_other", { problem: t(`rp_${problem}`), account: account ?? String(data.site.connectionId), discom });
  return `https://wa.me/${raw.length === 10 ? `91${raw}` : raw}?text=${encodeURIComponent(text)}`;
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
  const [noteOpen, setNoteOpen] = useState(false); // the optional note is a link until asked for (UX-N02)
  const [more, setMore] = useState(false); // everything that isn't THE action sits behind "More options" (UX-N01)
  const wa = useWhatsAppUrl(data, "no_power");

  const close = () => { setExtra(""); setFiled(null); setFileError(null); setAgain(false); setNoteOpen(false); setMore(false); onClose(); };
  const reveal = (f: (v: boolean) => void) => () => { animateNext(); f(true); };
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
  const running = useMyPlannedCuts().find((x) => x.start <= new Date()); // planned cut on this substation right now
  const holdForPlanned = !!running && !again; // like an open complaint: say so first, reporting is one more tap
  const holdForOpen = !!open && !again;
  const { locale } = useI18n();

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
          {!!running && <Insight tone="warn" icon="event" text={t("pc_running", { to: running.end.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) })} />}
          {holdForPlanned && !holdForOpen && <Button label={t("pc_ok")} onPress={close} />}
          {holdForPlanned && !holdForOpen && <TextLink label={t("pc_report_anyway")} onPress={() => setAgain(true)} />}
          {/* The open complaint IS the action: its page has the engineers to call, in order. */}
          {holdForOpen && <Button label={t("rp_see_open")} icon="supportAgent" onPress={seeOpen} />}
          {holdForOpen && <TextLink label={t("rp_report_again")} onPress={() => setAgain(true)} />}
          {!holdForOpen && !holdForPlanned && !failed && (
            <>
              {/* Where it goes, once, above the action (not a wall of text under it). */}
              <View style={styles.where}>
                <Icon name="home" size={16} color={c.muted} />
                <Txt v="caption" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {draft?.substation ? t("rp_sheet_where", { place: draft.substation }) : t("rp_getting_ready")}
                </Txt>
              </View>
              {/* Optional: most people skip it, so it's a link, not an empty box in the way (UX-N02). */}
              {noteOpen ? (
                <Field value={extra} onChangeText={setExtra} limit={150} multiline autoFocus
                  placeholder={t("rp_extra_ph")} accessibilityLabel={t("rp_extra_ph")}
                  style={styles.input} />
              ) : <TextLink label={t("rp_add_note")} onPress={reveal(setNoteOpen)} />}
              <Button label={busy ? t("rp_filing") : !draft ? t("rp_getting_ready") : t("rp_quick")} icon="bolt" busy={busy || !draft}
                onPress={() => (draft && !draft.substation ? full() : void file())} />
            </>
          )}
          {!holdForOpen && !holdForPlanned && (
            <>
              {!!draft?.blocked && <Insight tone="warn" text={t("rp_blocked", { msg: draft.blocked })} />}
              {filed && !filed.ok && <Insight tone="warn" text={t("rp_file_refused", { msg: filed.message || "—" })} />}
              {slow && !failed && <Insight tone="warn" icon="schedule" text={t("rp_slow")} />}
              {slow && !failed && <ReportFallback data={data} problem="no_power" onDone={close} lean />}
              {/* 1912 is OTP-login-only now: say it plainly, no "UPPCL is having a problem" + retry that can't work. */}
              {!!prepError && (cantFileKey(prepError) ? <Insight tone="accent" icon="info" text={t(cantFileKey(prepError)!)} /> : <ErrorNote error={prepError} onRetry={retry} />)}
              {!!fileError && <ErrorNote error={fileError} onRetry={() => void file()} />}
              {/* Can't file from here (not connected, offline, refused): the SMS works right now, so it is THE button (UX-R13). */}
              {failed && <ReportFallback data={data} problem="no_power" onDone={close} only lean />}
            </>
          )}
          {/* One link for the rest; each item is for a minority of visits (UX-N01). */}
          {more ? (
            <View>
              <TextLink label={t("rp_something_else")} onPress={full} />
              <PlannedCutsLink discom={String(data.site.tenantId)} />
              {!holdForOpen && (failed || slow) && wa && <TextLink label={t("rp_send_wa")} onPress={() => { openLink(wa); close(); }} />}
              <TollFreeLink />
              {/* Not signed in to 1912 (or it expired): connecting is for next time. */}
              {!holdForOpen && cantFileKey(prepError) === "rp_1912_login" && <TextLink label={t("c19_connect_next")} onPress={() => setConnect(true)} />}
              {!holdForOpen && cantFileKey(prepError) === "rp_1912_link" && <LinkHelp onCheck={retry} />}
            </View>
          ) : <TextLink label={t("rp_more_options")} onPress={reveal(setMore)} />}
          <Connect1912Sheet visible={connect} onClose={() => setConnect(false)} onDone={retry} />
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

/** PVVNL's daily "Scheduled Supply Outage Information" PDF: found on its home page when asked (straight from the
 *  phone), opened in the phone's PDF viewer. Falls back to PVVNL's site if the page changed or didn't load. */
export async function openPlannedCuts(): Promise<void> {
  let url = PVVNL_HOME;
  const get = async (u: string) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try { return await fetch(u, { signal: ctl.signal }); } finally { clearTimeout(timer); }
  };
  try {
    url = latestPlannedCutPdf(await (await get(PVVNL_HOME)).text()) ?? PVVNL_HOME;
    if (url !== PVVNL_HOME) {
      // In the app's own PDF viewer (Share / Save), like a bill — not a browser download.
      const bytes = new Uint8Array(await (await get(url)).arrayBuffer());
      if (bytes[0] === 0x25 && bytes[1] === 0x50) { // "%PDF"
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        await platform.savePdf(btoa(bin), `pvvnl-planned-cuts-${url.split("/").pop()}`);
        return;
      }
    }
  } catch { /* fall back to the browser below */ }
  await Linking.openURL(url);
}

/** "Is it a planned cut?" — only PVVNL publishes the daily list. */
export function PlannedCutsLink({ discom }: { discom: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  if (discom.toUpperCase() !== "PVVNL") return null;
  return <TextLink label={busy ? t("planned_opening") : t("planned_today")} onPress={() => { if (busy) return; setBusy(true); void openPlannedCuts().finally(() => setBusy(false)); }} />;
}

/**
 * The connection isn't linked to the user's 1912 number, so 1912 won't file for it. Linking happens on 1912's own
 * "Register Account" page (an OTP goes to the connection's registered mobile). Steps match that page as driven by hand
 * (Oct–Nov 2026), including its trap: "Record saved" followed by "Some problem occurred" can still have linked it.
 */
export function LinkHelp({ onCheck }: { onCheck: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <TextLink label={t("lk_how")} onPress={() => setOpen(true)} />
      <Sheet visible={open} title={t("lk_title")} onClose={() => setOpen(false)}>
        <Txt v="body" color="muted">{t("lk_why")}</Txt>
        {(["lk_1", "lk_2", "lk_3", "lk_4", "lk_5"] as const).map((k, i) => (
          <View key={k} style={styles.step}>
            <Txt v="label" weight="bold" color="primary">{i + 1}</Txt>
            <Txt v="body" style={{ flex: 1 }}>{t(k)}</Txt>
          </View>
        ))}
        <Button icon="openInNew" label={t("lk_open")} onPress={() => void Linking.openURL(LINK_ACCOUNT_URL)} />
        <Button kind="soft" icon="refresh" label={t("lk_check")} onPress={() => { setOpen(false); onCheck(); }} />
      </Sheet>
    </>
  );
}

/** 1912 rings busy in a big outage: UPPCL's toll-free line takes the same complaints. */
export function TollFreeLink() {
  const { t } = useI18n();
  return <TextLink label={t("toll_free")} onPress={() => void Linking.openURL(`tel:${HELPLINE_TOLL_FREE}`)} />;
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

/** Planned cuts on the user's substation (PVVNL's daily PDF, read on the phone), one entry per time window with its
 *  feeders. Substation (and city) come from the user's 1912 complaints; unknown → nothing (the PDF link stays). */
export function useMyPlannedCuts(): (MyCut & { feeders: string[] })[] {
  const { data: dash } = useDashboard();
  const pvvnl = String(dash?.site.tenantId ?? "").toUpperCase() === "PVVNL";
  const { data: cx } = useMyComplaints();
  const withSub = cx?.complaints.find((x) => x.substation);
  const { data: seen } = useSeenComplaintDetail(withSub?.complaint_no ?? "");
  const { data: list } = usePlannedCuts(pvvnl && !!withSub);
  const sub = withSub?.substation, city = cityOf(seen?.subdivision);
  return useMemo(() => {
    if (!sub) return [];
    const out: (MyCut & { feeders: string[] })[] = [];
    for (const c of myPlannedCuts(list, { substation: sub, city })) {
      const same = out.find((o) => +o.start === +c.start && +o.end === +c.end && o.substation === c.substation);
      if (same) { if (c.feeder) same.feeders.push(c.feeder); } else out.push({ ...c, feeders: c.feeder ? [c.feeder] : [] });
    }
    return out;
  }, [list, sub, city]);
}

/** "now · until 2 pm" / "today · 10 am – 2 pm" / "tomorrow · 10 am – 2 pm" as one line. */
export function useCutWhen() {
  const { t, locale } = useI18n();
  const hm = (d: Date) => d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return (c: MyCut, now = new Date()) => {
    if (c.start <= now) return t("pc_now", { to: hm(c.end) });
    const today = c.start.toDateString() === now.toDateString();
    return t(today ? "pc_today" : "pc_tomorrow", { from: hm(c.start), to: hm(c.end) });
  };
}

/** Home: the next planned cut on the user's substation, one line; tap for the details. Nothing when none matched. */
export function PlannedCutBanner() {
  const c = useColors();
  const cuts = useMyPlannedCuts();
  const when = useCutWhen();
  const [open, setOpen] = useState(false);
  const x = cuts[0];
  if (!x) return null;
  const sub = [x.substation, x.reason].filter(Boolean).join(" · ");
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${when(x)}. ${sub}`} onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.banner, { backgroundColor: c.surface, borderColor: c.line, opacity: pressed ? 0.85 : 1 }]}>
        <View style={[styles.bannerIcon, { backgroundColor: c.pill }]}><Icon name="event" size={20} color={c.pillText} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt v="body" weight="semibold" numberOfLines={2}>{when(x)}</Txt>
          <Txt v="caption" color="muted" numberOfLines={1}>{sub}</Txt>
        </View>
        <Icon name="chevronRight" size={20} color={c.muted} />
      </Pressable>
      <PlannedCutSheet cuts={cuts} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Every matched window: when, substation, feeders, why, areas; the full PDF one tap away. */
export function PlannedCutSheet({ cuts, visible, onClose }: { cuts: (MyCut & { feeders: string[] })[]; visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { t } = useI18n();
  const when = useCutWhen();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible={visible} title={t("pc_title")} onClose={onClose}>
      {cuts.map((x, i) => (
        <View key={i} style={[styles.cut, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, paddingTop: 12 }]}>
          <Txt v="body" weight="semibold">{when(x)}</Txt>
          {([["pc_substation", x.substation], ["pc_feeder", x.feeders.join(", ")], ["pc_why", x.reason], ["pc_areas", x.area]] as const).map(([k, v]) => !!v && (
            <View key={k} style={styles.cutRow}>
              <Txt v="caption" color="muted" style={{ width: 88 }}>{t(k)}</Txt>
              <Txt v="caption" style={{ flex: 1 }} numberOfLines={3}>{v}</Txt>
            </View>
          ))}
        </View>
      ))}
      <Txt v="caption" color="muted">{t("pc_source")}</Txt>
      <Button kind="soft" icon="openInNew" label={busy ? t("planned_opening") : t("pc_open_pdf")}
        onPress={() => { if (busy) return; setBusy(true); void openPlannedCuts().finally(() => setBusy(false)); }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12, minHeight: 64 },
  bannerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  cut: { gap: 6 },
  cutRow: { flexDirection: "row", gap: 8 },
  link: { minHeight: 48, paddingHorizontal: 12, justifyContent: "center", alignSelf: "center" },
  danger: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  step: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  dangerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  where: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4 },
  done: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 104 },
});
