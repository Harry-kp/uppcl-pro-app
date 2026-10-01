/**
 * The full complaint form (from "Something else?" on the No power sheet), built the mobile way: a short list
 * of rows showing the current answer ("Problem · No power ›"); tapping a row opens a bottom sheet to change it.
 * Everything starts filled in (problem, the user's home, a timed note), so most people only press File.
 * Danger isn't a complaint type: it's a call, its own red row at the end.
 */
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { mutate, useDashboard } from "@shared/api";
import { chooseDivision, chooseSubstation, fileSupplyComplaint, listDistricts, prepareSupplyComplaint, withContact, type Place, type SupplyDraft } from "@shared/complaints";
import { HELPLINE_TEL } from "@shared/outage";
import { ErrorNote } from "../src/errors";
import { useI18n } from "../src/i18n";
import { Icon, type IconName } from "../src/icons";
import { Filed, ReportFallback, useOwnDraft } from "../src/report";
import { useColors } from "../src/theme";
import { BackHeader, Button, Card, Choices, Insight, Screen, Sheet, Skeleton, Txt, familyFor } from "../src/ui";

type Supply = "no_power" | "voltage" | "phase";
type Edit = "problem" | "where" | "affected" | "note" | "contact" | "division" | "substation" | null;

export default function Report() {
  const c = useColors();
  const { t, lang } = useI18n();
  const params = useLocalSearchParams<{ problem?: Supply }>();
  const { data } = useDashboard();
  const [supply, setSupply] = useState<Supply>(params.problem ?? "no_power");
  const [whose, setWhose] = useState<"mine" | "other">("mine");
  const own = useOwnDraft(data, supply, whose === "mine");
  const [edit, setEdit] = useState<Edit>(null);

  // Someone else's connection: account + district → (division) → (substation).
  const [otherAcct, setOtherAcct] = useState("");
  const [districts, setDistricts] = useState<Place[]>([]);
  const [districtQ, setDistrictQ] = useState("");
  const [district, setDistrict] = useState<Place | null>(null);
  const [other, setOther] = useState<SupplyDraft | null>(null);
  useEffect(() => { if (edit === "where" && !districts.length) listDistricts().then(setDistricts, () => {}); }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOther(null); if (whose === "other") setWhose("mine"); }, [supply]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = whose === "mine" ? own.draft : other;
  const setDraft = whose === "mine" ? own.setDraft : setOther;
  const [outage, setOutage] = useState<"Individual" | "Area">("Individual");
  const [note, setNote] = useState("");
  useEffect(() => { setNote(t(`rp_note_${supply}`, { time: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) })); }, [supply]); // eslint-disable-line react-hooks/exhaustive-deps
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filed, setFiled] = useState<{ ok: boolean; complaintNo: string | null; message: string } | null>(null);

  async function run<T>(f: () => Promise<T>, then: (v: T) => void) {
    setBusy(true); setError(null);
    try { then(await f()); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const find = () => district && run(() => prepareSupplyComplaint({
    account: otherAcct, city: null, districtId: district.id, problem: supply === "voltage" ? "voltage" : "no_power", outage: "Individual",
  }), (d) => { setOther(d); setWhose("other"); setEdit(null); });
  const file = () => draft && run(() => {
    let d: SupplyDraft = { ...draft, controls: { ...draft.controls, 95303: supply === "voltage" ? "" : outage } };
    if (contact) d = withContact(d, contact, whose === "other" ? "Others" : "Family");
    return fileSupplyComplaint(d, note);
  }, (r) => { setFiled(r); void mutate((k) => typeof k === "string" && k.startsWith("/complaints")); });

  const input = [styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.line, fontFamily: familyFor("medium", lang === "hi") }];
  const dq = districtQ.trim().toLowerCase();
  const matches = dq ? districts.filter((x) => x.name.toLowerCase().includes(dq)).slice(0, 6) : [];
  const prepError = whose === "mine" ? own.error : null;
  const tail = (s: string | undefined) => (s ? `••${s.slice(-4)}` : "");
  const needDivision = !!draft && draft.divisions.length > 0;
  const needSubstation = !!draft && !draft.substation && draft.substations.length > 0;
  const canFile = !!draft?.substation && !draft.blocked && !!note.trim() && !busy;
  // A disabled button always says what it's waiting for.
  const fileLabel = busy ? t("rp_filing") : !draft ? (prepError ? t("rp_file") : t("rp_getting_ready"))
    : needDivision || needSubstation ? t("rp_need_substation") : !note.trim() ? t("rp_need_note") : t("rp_file");

  if (filed?.ok) return (
    <Screen>
      <BackHeader title={t("rp_form_title")} />
      <Filed complaintNo={filed.complaintNo} place={draft?.substation} onTrack={() => { router.back(); router.push("/complaints"); }} />
    </Screen>
  );

  return (
    <Screen footer={<Button label={fileLabel} busy={busy || (!draft && !prepError)} disabled={!canFile} onPress={() => void file()} />}>
      <BackHeader title={t("rp_form_title")} />

      <Card style={{ padding: 0, gap: 0 }}>
        <Row first icon="bolt" label={t("rp_row_problem")} value={t(`rp_chip_${supply}`)} onPress={() => setEdit("problem")} />
        <Row icon={whose === "mine" ? "home" : "person"} label={t("rp_row_where")}
          value={whose === "mine" ? t("rp_mine") : (other?.name ?? t("rp_found_no_name"))}
          sub={draft?.substation ? `${draft.substation} · ${tail(draft.account)}` : draft ? tail(draft.account) : undefined}
          loading={!draft && !prepError} onPress={() => setEdit("where")} />
        {needDivision && <Row icon="info" label={t("rp_row_division")} value={t("rp_choose")} attention onPress={() => setEdit("division")} />}
        {needSubstation && <Row icon="info" label={t("rp_row_substation")} value={t("rp_choose")} attention onPress={() => setEdit("substation")} />}
        {supply !== "voltage" && ( // 1912 asks this for no supply only
          <Row icon="widgets" label={t("rp_row_affected")} value={outage === "Individual" ? t("rp_just_me") : t("rp_area")} onPress={() => setEdit("affected")} />
        )}
        <Row icon="chat" label={t("rp_row_note")} sub={note} onPress={() => setEdit("note")} />
        <Row icon="call" label={t("rp_row_contact")} value={contact ? `••${contact.slice(-4)}` : t("rp_optional")} onPress={() => setEdit("contact")} />
      </Card>

      {!!prepError && <ErrorNote error={prepError} onRetry={own.retry} />}
      {!!error && <ErrorNote error={error} onRetry={() => void file()} />}
      {!!draft?.blocked && <Insight tone="warn" text={t("rp_blocked", { msg: draft.blocked })} />}
      {filed && !filed.ok && <Insight tone="warn" text={t("rp_file_refused", { msg: filed.message || "—" })} />}
      {(!!error || !!prepError || !!draft?.blocked || (filed && !filed.ok)) && data && <ReportFallback data={data} problem={supply} />}

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
        <TextInput value={note} onChangeText={(x) => setNote(x.slice(0, 200))} multiline autoFocus accessibilityLabel={t("rp_row_note")} style={[input, { minHeight: 96 }]} />
        <Button label={t("rp_done")} disabled={!note.trim()} onPress={() => setEdit(null)} />
      </Sheet>

      <Sheet visible={edit === "contact"} title={t("rp_row_contact")} onClose={() => setEdit(null)}>
        <Txt v="label" color="muted">{t("rp_contact_why")}</Txt>
        <TextInput value={contact} onChangeText={(x) => setContact(x.replace(/\D/g, "").slice(0, 10))} keyboardType="phone-pad" autoFocus
          placeholder={t("rp_contact_ph")} placeholderTextColor={c.muted} accessibilityLabel={t("rp_row_contact")} style={input} />
        <Button label={t("rp_done")} disabled={!!contact && contact.length !== 10} onPress={() => setEdit(null)} />
        {!!contact && <Button kind="soft" label={t("rp_remove")} onPress={() => { setContact(""); setEdit(null); }} />}
      </Sheet>

      <Sheet visible={edit === "where"} title={t("rp_row_where")} onClose={() => setEdit(null)}>
        <Choices<"mine" | "other"> value={whose === "mine" ? "mine" : "other"}
          onChange={(v) => { if (v === "mine") { setWhose("mine"); setEdit(null); } else setWhose("other"); }}
          options={[{ value: "mine", label: t("rp_mine") }, { value: "other", label: t("rp_someone_elses") }]} />
        {whose === "other" && (
          <>
            <TextInput value={otherAcct} onChangeText={(x) => setOtherAcct(x.replace(/\D/g, "").slice(0, 12))} keyboardType="number-pad"
              placeholder={t("rp_their_account")} placeholderTextColor={c.muted} accessibilityLabel={t("rp_their_account")} style={input} />
            {district ? (
              <Row first icon="event" label={t("rp_district")} value={district.name} onPress={() => setDistrict(null)} />
            ) : (
              <>
                <TextInput value={districtQ} onChangeText={setDistrictQ} placeholder={t("rp_their_district")} placeholderTextColor={c.muted}
                  accessibilityLabel={t("rp_their_district")} style={input} />
                <Choices value="" onChange={(id) => { setDistrict(districts.find((x) => x.id === id) ?? null); setDistrictQ(""); }}
                  options={matches.map((x) => ({ value: x.id, label: x.name }))} />
              </>
            )}
            {!!error && <ErrorNote error={error} compact />}
            <Button label={t("rp_find")} busy={busy} disabled={otherAcct.length < 10 || !district} onPress={() => void find()} />
          </>
        )}
      </Sheet>

      <Sheet visible={edit === "division"} title={t("rp_row_division")} onClose={() => setEdit(null)}>
        <Txt v="label" color="muted">{t("rp_pick_division")}</Txt>
        {!!draft && <Choices value="" onChange={(id) => { setEdit(null); void run(() => chooseDivision(draft, id), setDraft); }}
          options={draft.divisions.map((x) => ({ value: x.id, label: x.name }))} />}
      </Sheet>

      <Sheet visible={edit === "substation"} title={t("rp_row_substation")} onClose={() => setEdit(null)}>
        <Txt v="label" color="muted">{t("rp_pick_substation")}</Txt>
        {!!draft && <Choices value="" onChange={(id) => { setEdit(null); void run(() => chooseSubstation(draft, id), setDraft); }}
          options={draft.substations.map((x) => ({ value: x.id, label: x.name }))} />}
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
  input: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10, minHeight: 50, fontSize: 16, textAlignVertical: "top" },
});
