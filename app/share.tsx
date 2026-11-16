/**
 * "Who can see this connection": UPPCL SMART's guest access, owner side. Invite someone by mobile until a date; UPPCL
 * texts them and, signed in to UPPCL SMART with that number, they see this connection's bills, payments and daily
 * units. Only what was checked is promised (read-only). Every write is an explicit tap; Remove asks first; Resend
 * once a day per person (it texts them).
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { extendGuest, inviteGuest, removeGuest, useGuests, type Guest } from "@shared/api";
import { parseUppclDate } from "@shared/utils";
import { keystore } from "../src/boot";
import { ErrorNote } from "../src/errors";
import { useI18n } from "../src/i18n";
import { Icon } from "../src/icons";
import { useColors } from "../src/theme";
import { BackHeader, Button, Card, Choices, Field, Insight, Pill, Screen, Sheet, SkeletonRows, SlowNote, Txt } from "../src/ui";

type Span = "1m" | "6m" | "1y";
const MONTHS: Record<Span, number> = { "1m": 1, "6m": 6, "1y": 12 }; // capped at a year: access never quietly runs forever
const RESEND_KEY = "guest_resent_"; // + id → ms; one resend a day per person
const DAY = 86_400_000;

const until = (span: Span) => { const d = new Date(); d.setMonth(d.getMonth() + MONTHS[span]); return d; };
const mobileOf = (v: string) => { let d = v.replace(/\D/g, ""); if (d.length === 12 && d.startsWith("91")) d = d.slice(2); if (d.length === 11 && d.startsWith("0")) d = d.slice(1); return /^[6-9]\d{9}$/.test(d) ? d : null; };
const spaced = (m: string) => `+91 ${m.slice(0, 5)} ${m.slice(5)}`;
const nameOf = (g: Guest) => [g.first_name, g.last_name].filter(Boolean).join(" ") || (g.phone ? `••${g.phone.slice(-4)}` : g.email ?? "—");
const endOf = (g: Guest) => (g.endDate ? parseUppclDate(g.endDate) ?? new Date(g.endDate) : null);
const ended = (g: Guest) => g.status === "expired" || (endOf(g)?.getTime() ?? Infinity) < Date.now();

export default function Share() {
  const c = useColors();
  const { t, locale } = useI18n();
  const { data, error, isLoading, mutate } = useGuests();
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<Guest | null>(null);
  const date = (d: Date | null) => d?.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) ?? "";
  const status = (g: Guest) => (ended(g) ? t("sh_ended") : g.status === "pending" ? t("sh_waiting") : t("sh_till", { date: date(endOf(g)) }));

  return (
    <Screen>
      <BackHeader title={t("sh_title")} />
      <Txt v="body" color="muted">{t("sh_what")}</Txt>

      {error && !data ? <ErrorNote error={error} onRetry={() => void mutate()} />
        : !data && isLoading ? <><Card style={{ padding: 0, gap: 0 }}><SkeletonRows n={2} /></Card><SlowNote loading /></>
        : data && data.length > 0 ? (
          <Card style={{ padding: 0, gap: 0 }}>
            {data.map((g, i) => (
              // One label for the whole row (name, status, date): a colour-only chip isn't announced.
              <Pressable key={g._id} accessibilityRole="button" accessibilityLabel={`${nameOf(g)}, ${status(g)}`} onPress={() => setOpen(g)}
                style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt v="body" weight="semibold" numberOfLines={1}>{nameOf(g)}</Txt>
                  {!!g.phone && <Txt v="caption" color="muted" numeric>{`••${g.phone.slice(-4)}`}</Txt>}
                </View>
                <Pill label={status(g)} tone={ended(g) ? "warn" : g.status === "pending" ? "accent" : "ok"} />
                <Icon name="chevronRight" size={20} color={c.muted} />
              </Pressable>
            ))}
          </Card>
        ) : <Insight tone="accent" icon="info" text={t("sh_none")} />}

      <Button label={t("sh_invite")} icon="person" onPress={() => setInviting(true)} />

      <InviteSheet visible={inviting} onClose={() => setInviting(false)} />
      <GuestSheet guest={open} status={open ? status(open) : ""} onClose={() => setOpen(null)} date={date} />
    </Screen>
  );
}

/** Name → mobile → how long, then a review step that repeats the number in big digits (a wrong digit is the likely mistake). */
function InviteSheet({ visible, onClose, again }: { visible: boolean; onClose: () => void; again?: Guest }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(again ? [again.first_name, again.last_name].filter(Boolean).join(" ") : "");
  const [mobile, setMobile] = useState(again?.phone ?? "");
  const [span, setSpan] = useState<Span>("6m");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const m = mobileOf(mobile);
  const close = () => { setReview(false); setError(null); onClose(); };
  async function send() {
    if (!m) return;
    const [first, ...rest] = name.trim().split(/\s+/);
    setBusy(true); setError(null);
    try { await inviteGuest({ first: first ?? "", last: rest.join(" "), to: { phone: m }, until: until(span) }); close(); setName(""); setMobile(""); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible={visible} title={review ? t("sh_review_title") : t("sh_invite")} onClose={close}>
      {!review ? (
        <>
          <Txt v="label" color="muted">{t("sh_name")}</Txt>
          <Field value={name} onChangeText={setName} autoCapitalize="words" accessibilityLabel={t("sh_name")} placeholder={t("sh_name_ph")} />
          <Txt v="label" color="muted">{t("si_mobile")}</Txt>
          <Field value={mobile} onChangeText={setMobile} keyboardType="phone-pad" autoComplete="tel" accessibilityLabel={t("si_mobile")} placeholder={t("c19_mobile_ph")} />
          <Txt v="label" color="muted">{t("sh_how_long")}</Txt>
          <Choices<Span> value={span} onChange={setSpan} options={[{ value: "1m", label: t("sh_1m") }, { value: "6m", label: t("sh_6m") }, { value: "1y", label: t("sh_1y") }]} />
          <Txt v="caption" color="muted">{t("sh_till_words", { date: until(span).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) })}</Txt>
          <Insight tone="warn" icon="info" text={t("sh_trust")} />
          <Button label={t("sh_next")} disabled={!name.trim() || !m} onPress={() => setReview(true)} />
        </>
      ) : (
        <>
          <Txt v="body">{t("sh_send_to", { name: name.trim() })}</Txt>
          <Txt v="title" numeric style={{ letterSpacing: 1 }}>{m ? spaced(m) : ""}</Txt>
          <Txt v="caption" color="muted">{t("sh_sms_note")}</Txt>
          {!!error && <ErrorNote error={error} compact />}
          <Button label={t("sh_send")} icon="sms" busy={busy} onPress={() => void send()} />
          <Button kind="soft" label={t("sh_edit")} disabled={busy} onPress={() => setReview(false)} />
        </>
      )}
    </Sheet>
  );
}

/** One person: what they have, and full-size buttons for what can be done (Resend / Extend / Stop sharing / Invite again). */
function GuestSheet({ guest, status, onClose, date }: { guest: Guest | null; status: string; onClose: () => void; date: (d: Date | null) => string }) {
  const { t } = useI18n();
  const [step, setStep] = useState<"main" | "extend" | "remove">("main");
  const [span, setSpan] = useState<Span>("6m");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [inviteAgain, setInviteAgain] = useState(false);
  const close = () => { setStep("main"); setError(null); setNote(null); onClose(); };
  if (!guest) return null;
  const g = guest;
  const resentAt = Number(keystore.getItem(RESEND_KEY + g._id) ?? 0);
  const canResend = Date.now() - resentAt > DAY;
  async function run(f: () => Promise<void>, done?: string) {
    setBusy(true); setError(null);
    try { await f(); if (done) setNote(done); else close(); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  const [first, ...rest] = (g.first_name ? [g.first_name, g.last_name ?? ""] : [nameOf(g), ""]);
  return (
    <>
      <Sheet visible={!inviteAgain} title={step === "remove" ? t("sh_remove_title", { name: nameOf(g) }) : nameOf(g)} onClose={close}>
        {step === "main" && (
          <>
            <Txt v="body" color="muted">{status}</Txt>
            {!!note && <Insight tone="ok" icon="checkCircle" text={note} />}
            {!!error && <ErrorNote error={error} compact />}
            {ended(g) ? (
              <Button label={t("sh_invite_again")} icon="person" onPress={() => setInviteAgain(true)} />
            ) : (
              <>
                {g.status === "pending" && !!g.phone && (
                  <Button kind="soft" icon="sms" label={canResend ? t("sh_resend") : t("sh_resent")} disabled={!canResend || busy}
                    onPress={() => void run(async () => {
                      await inviteGuest({ first, last: rest.join(" "), to: { phone: g.phone! }, until: endOf(g) ?? until("6m"), resend: true });
                      keystore.setItem(RESEND_KEY + g._id, String(Date.now()));
                    }, t("sh_resent"))} />
                )}
                <Button kind="soft" icon="schedule" label={t("sh_extend")} onPress={() => setStep("extend")} />
                <Button kind="critical" label={t("sh_stop")} onPress={() => setStep("remove")} />
              </>
            )}
          </>
        )}
        {step === "extend" && (
          <>
            <Choices<Span> value={span} onChange={setSpan} options={[{ value: "1m", label: t("sh_1m") }, { value: "6m", label: t("sh_6m") }, { value: "1y", label: t("sh_1y") }]} />
            <Txt v="caption" color="muted">{t("sh_till", { date: date(until(span)) })}</Txt>
            {!!error && <ErrorNote error={error} compact />}
            <Button label={t("sh_extend")} busy={busy} onPress={() => void run(() => extendGuest(g._id, until(span)))} />
            <Button kind="soft" label={t("cancel")} disabled={busy} onPress={() => setStep("main")} />
          </>
        )}
        {step === "remove" && (
          <>
            <Txt v="body">{t("sh_remove_body")}</Txt>
            {!!error && <ErrorNote error={error} compact />}
            <Button kind="critical" label={t("sh_stop")} busy={busy} onPress={() => void run(() => removeGuest(g._id))} />
            <Button kind="soft" label={t("cancel")} disabled={busy} onPress={() => setStep("main")} />
          </>
        )}
      </Sheet>
      <InviteSheet visible={inviteAgain} again={g} onClose={() => { setInviteAgain(false); close(); }} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 },
});
