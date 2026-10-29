/**
 * The full complaint form (from "Something else?" on the No power sheet), built the mobile way: a short list
 * of rows showing the current answer ("Problem · No power ›"); tapping a row opens a bottom sheet to change it.
 * Everything starts filled in (problem, the user's home, a timed note), so most people only press File.
 * Someone else's connection is just their account number: filed here if it's on the user's 1912 number, else by SMS.
 * Danger isn't a complaint type: it's a call, its own red row at the end.
 */
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { mutate, useDashboard } from "@shared/api";
import { fileSupplyComplaint, HELPLINE_TEL, is1912NotLinked, prepareSupplyComplaint, type SupplyDraft } from "@shared/complaints";
import { ErrorNote } from "../src/errors";
import { useI18n } from "../src/i18n";
import { Icon, type IconName } from "../src/icons";
import { cantFileKey, Filed, ReportFallback, useOwnDraft } from "../src/report";
import { useColors } from "../src/theme";
import { BackHeader, Button, Card, Choices, Insight, Screen, Sheet, Skeleton, Txt, Field } from "../src/ui";

type Supply = "no_power" | "voltage" | "phase";
type Edit = "problem" | "where" | "affected" | "note" | null;

export default function Report() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ problem?: Supply }>();
  const { data } = useDashboard();
  const [supply, setSupply] = useState<Supply>(params.problem ?? "no_power");
  const [whose, setWhose] = useState<"mine" | "other">("mine");
  const own = useOwnDraft(data, supply, whose === "mine");
  const [edit, setEdit] = useState<Edit>(null);

  // Someone else's connection: just their account number. 1912 files it in-app only if it's added to the
  // user's 1912 number; otherwise it goes by SMS / WhatsApp / call (their number in the text).
  const [otherAcct, setOtherAcct] = useState("");
  const [other, setOther] = useState<{ draft: SupplyDraft | null; error: unknown; checking: boolean }>({ draft: null, error: null, checking: false });
  useEffect(() => {
    if (whose !== "other" || otherAcct.length !== 10) return;
    let live = true;
    setOther({ draft: null, error: null, checking: true });
    prepareSupplyComplaint({ account: otherAcct, problem: supply === "voltage" ? "voltage" : "no_power", outage: "Individual" })
      .then((d) => live && setOther({ draft: d, error: null, checking: false }), (e) => live && setOther({ draft: null, error: e, checking: false }));
    return () => { live = false; };
  }, [whose, otherAcct, supply]);

  const mine = whose === "mine";
  const draft = mine ? own.draft : other.draft;
  const [outage, setOutage] = useState<"Individual" | "Area">("Individual");
  const [note, setNote] = useState("");
  useEffect(() => { setNote(t(`rp_note_${supply}`, { time: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) })); }, [supply]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filed, setFiled] = useState<{ ok: boolean; complaintNo: string | null; message: string } | null>(null);

  const file = async () => {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      setFiled(await fileSupplyComplaint({ ...draft, controls: { ...draft.controls, 95303: supply === "voltage" ? "" : outage } }, note));
      void mutate((k) => typeof k === "string" && k.startsWith("/complaints"));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const prepError = mine ? own.error : other.error;
  const tail = (s: string) => `••${s.slice(-4)}`;
  // Someone else's and 1912 won't file it here (not added to this number, or the check failed): the texts are the way,
  // so the questions only the in-app form carries are hidden.
  const otherByText = !mine && !!other.error;
  const paused = !!cantFileKey(prepError) || otherByText;
  const waiting = mine ? !draft && !prepError : other.checking || otherAcct.length !== 10;
  const canFile = !!draft?.substation && !draft.blocked && !!note.trim() && !busy;
  // A disabled button always says what it's waiting for.
  const fileLabel = busy ? t("rp_filing") : !mine && otherAcct.length !== 10 ? t("rp_acct_digits", { n: otherAcct.length })
    : !draft ? t("rp_getting_ready") : !note.trim() ? t("rp_need_note") : mine ? t("rp_file") : t("rp_file_for", { acct: tail(otherAcct) });

  if (filed?.ok) return (
    <Screen>
      <BackHeader title={t("rp_form_title")} />
      <Filed complaintNo={filed.complaintNo} place={draft?.substation} onTrack={() => { router.back(); router.push("/complaints"); }} />
    </Screen>
  );

  return (
    // While the app can't file, no dead primary button: the SMS/WhatsApp/call ways below are the action.
    <Screen footer={paused ? undefined : <Button label={fileLabel} busy={busy || (waiting && otherAcct.length === 10) || (mine && waiting)} disabled={!canFile} onPress={() => void file()} />}>
      <BackHeader title={t("rp_form_title")} />

      <Card style={{ padding: 0, gap: 0 }}>
        <Row first icon="bolt" label={t("rp_row_problem")} value={t(`rp_chip_${supply}`)} onPress={() => setEdit("problem")} />
        <Row icon={mine ? "home" : "person"} label={t("rp_row_where")}
          value={mine ? t("rp_mine") : t("rp_someone_elses_short")}
          sub={!mine ? [otherAcct.length === 10 ? tail(otherAcct) : t("rp_acct_digits", { n: otherAcct.length }), draft?.substation].filter(Boolean).join(" · ")
            : draft?.substation ? `${draft.substation} · ${tail(draft.account)}` : draft ? tail(draft.account) : undefined}
          loading={mine ? waiting : other.checking} attention={!mine && otherAcct.length !== 10} onPress={() => setEdit("where")} />
        {supply !== "voltage" && !otherByText && ( // 1912 asks this for no supply only; an SMS can't carry it
          <Row icon="widgets" label={t("rp_row_affected")} value={outage === "Individual" ? t("rp_just_me") : t("rp_area")} onPress={() => setEdit("affected")} />
        )}
        {!otherByText && <Row icon="chat" label={t("rp_row_note")} sub={note} onPress={() => setEdit("note")} />}
      </Card>

      {otherByText && <Insight tone="accent" icon="info" text={t(is1912NotLinked(other.error) ? "rp_other_by_text" : (cantFileKey(other.error) ?? "rp_other_by_text"))} />}
      {mine && !!prepError && (cantFileKey(prepError) ? <Insight tone="accent" icon="info" text={t(cantFileKey(prepError)!)} /> : <ErrorNote error={prepError} onRetry={own.retry} />)}
      {!!error && <ErrorNote error={error} onRetry={() => void file()} />}
      {!!draft?.blocked && <Insight tone="warn" text={t("rp_blocked", { msg: draft.blocked })} />}
      {filed && !filed.ok && <Insight tone="warn" text={t("rp_file_refused", { msg: filed.message || "—" })} />}
      {(!!error || !!prepError || !!draft?.blocked || (filed && !filed.ok)) && data &&
        <ReportFallback data={data} problem={supply} only={paused} account={mine ? undefined : otherAcct} />}

      {/* Danger is a call, not a form. */}
      <Card style={{ padding: 0, gap: 0 }}>
        <Row first icon="warning" danger label={t("rp_danger_row")} sub={t("rp_danger_row_sub")} chevron="call"
          onPress={() => void Linking.openURL(`tel:${HELPLINE_TEL}`)} />
      </Card>

      {/* One sheet per row: change one answer, close, back on the list. */}
      <Sheet visible={edit === "problem"} title={t("rp_row_problem")} onClose={() => setEdit(null)}>
        <Choices<Supply> value={supply} onChange={(v) => { setSupply(v); setEdit(null); }}
          options={(["no_power", "voltage", "phase"] as const).map((v) => ({ value: v, label: t(`rp_${v}`) }))} />
      </Sheet>

      <Sheet visible={edit === "affected"} title={t("rp_row_affected")} onClose={() => setEdit(null)}>
        <Choices<"Individual" | "Area"> value={outage} onChange={(v) => { setOutage(v); setEdit(null); }}
          options={[{ value: "Individual", label: t("rp_just_me") }, { value: "Area", label: t("rp_area") }]} />
      </Sheet>

      <Sheet visible={edit === "note"} title={t("rp_row_note")} onClose={() => setEdit(null)}>
        <Field value={note} onChangeText={(x) => setNote(x.slice(0, 200))} multiline autoFocus accessibilityLabel={t("rp_row_note")} />
        <Button label={t("rp_done")} disabled={!note.trim()} onPress={() => setEdit(null)} />
      </Sheet>

      <Sheet visible={edit === "where"} title={t("rp_row_where")} onClose={() => setEdit(null)}>
        <Choices<"mine" | "other"> value={whose}
          onChange={(v) => { setWhose(v); if (v === "mine") setEdit(null); }}
          options={[{ value: "mine", label: t("rp_mine") }, { value: "other", label: t("rp_someone_elses") }]} />
        {!mine && (
          <>
            <Txt v="label" color="muted">{t("rp_their_account")}</Txt>
            {/* Exactly 10 digits (pasted spaces / dashes dropped); the sheet closes itself on the 10th. */}
            <Field value={otherAcct} autoFocus keyboardType="number-pad" inputMode="numeric" maxLength={10}
              placeholder="12345 67890" accessibilityLabel={t("rp_their_account")} style={{ fontSize: 22, letterSpacing: 2 }}
              onChangeText={(x) => { const d = x.replace(/\D/g, "").slice(0, 10); setOtherAcct(d); if (d.length === 10) setEdit(null); }} />
            <Button label={otherAcct.length === 10 ? t("rp_done") : t("rp_acct_digits", { n: otherAcct.length })}
              disabled={otherAcct.length !== 10} onPress={() => setEdit(null)} />
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/** A list row: icon, label, current answer (or a preview line), chevron. 56dp+, the whole row is the target. */
function Row({ icon, label, value, sub, onPress, first, loading, attention, danger, chevron = "chevronRight" }: {
  icon: IconName; label: string; value?: string; sub?: string; onPress: () => void; first?: boolean; loading?: boolean
  attention?: boolean; danger?: boolean; chevron?: IconName;
}) {
  const c = useColors();
  const tint = danger ? c.critical : attention ? c.warn : c.primary;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}${value ? `, ${value}` : ""}`} onPress={onPress}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
      <View style={[styles.rowIcon, { backgroundColor: danger ? c.criticalSoft : c.pill }]}><Icon name={icon} size={20} color={tint} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="body" weight="semibold" color={danger ? "critical" : undefined} numberOfLines={1}>{label}</Txt>
        {loading ? <Skeleton w="60%" h={12} /> : !!sub && <Txt v="caption" color="muted" numberOfLines={1}>{sub}</Txt>}
      </View>
      {!!value && <Txt v="label" weight="semibold" color={attention ? "warn" : "muted"} numberOfLines={1} style={{ maxWidth: "45%" }}>{value}</Txt>}
      <Icon name={chevron} size={20} color={danger ? c.critical : c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
