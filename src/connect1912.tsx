/**
 * "Connect to 1912": the OTP sign-in UPPCL's complaint service needs since Oct 2026. It is separate from the
 * UPPCL SMART sign-in (another UPPCL system, another vendor), so the sheet says why before asking.
 * Number prefilled from the SMART profile; the code fills itself from the SMS (Android autofill) and is
 * checked on the 6th digit. A number new to 1912 must first "Register yourself" on 1912's site (once).
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { mutate, useMe } from "@shared/api";
import { connected1912, mobile10, needsKyc1912, send1912Otp, verify1912Otp } from "@shared/complaints";
import { ErrorNote } from "./errors";
import { useI18n } from "./i18n";
import { Button, Field, Insight, Sheet, Txt } from "./ui";
import { openLink } from "./links";

const RESEND_S = 30;

export function Connect1912Sheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone?: () => void }) {
  const { t } = useI18n();
  const { data: me } = useMe();
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"number" | "code" | "kyc">("number");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [wait, setWait] = useState(0);

  // Fresh each time it opens: the last number used, else the SMART profile's.
  useEffect(() => {
    if (!visible) return;
    setStep("number"); setCode(""); setError(null);
    setMobile(connected1912() ?? mobile10(me?.data?.[0]?.phone) ?? "");
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function sendCode() {
    setBusy(true); setError(null);
    try { await send1912Otp(mobile); setStep("code"); setCode(""); setWait(RESEND_S); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  async function check(otp: string) {
    setBusy(true); setError(null);
    try {
      await verify1912Otp(mobile, otp);
      await mutate((k) => typeof k === "string" && k.startsWith("/complaints"));
      if (needsKyc1912()) setStep("kyc");
      else { onDone?.(); onClose(); }
    } catch (e) { setError(e); setCode(""); }
    finally { setBusy(false); }
  }

  return (
    <Sheet visible={visible} title={step === "kyc" ? t("c19_kyc_title") : t("c19_title")} onClose={onClose}>
      {step === "number" && (
        <>
          <Txt v="body" color="muted">{t("c19_why")}</Txt>
          <Field value={mobile} onChangeText={(v) => setMobile(v.replace(/[^0-9]/g, "").slice(0, 10))}
            keyboardType="number-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={10}
            placeholder={t("c19_mobile_ph")} accessibilityLabel={t("c19_mobile")} returnKeyType="send"
            onSubmitEditing={() => mobile.length === 10 && sendCode()} />
          <Txt v="caption" color="muted">{t("c19_first_time")}</Txt>
          {!!error && <ErrorNote error={error} compact />}
          <Button label={busy ? t("c19_sending") : t("c19_send")} icon="chat" busy={busy} disabled={mobile.length !== 10} onPress={sendCode} />
        </>
      )}

      {step === "code" && (
        <>
          <Txt v="body" color="muted">{t("c19_sent_to", { mobile: `•••• ${mobile.slice(-4)}` })}</Txt>
          <Field value={code} autoFocus keyboardType="number-pad" maxLength={6}
            autoComplete="sms-otp" textContentType="oneTimeCode" importantForAutofill="yes"
            placeholder="••••••" accessibilityLabel={t("c19_code")} style={{ fontSize: 24, letterSpacing: 8, textAlign: "center" }}
            onChangeText={(v) => { const d = v.replace(/[^0-9]/g, "").slice(0, 6); setCode(d); if (d.length === 6 && !busy) void check(d); }} />
          {!!error && <ErrorNote error={error} compact />}
          <Button label={busy ? t("c19_checking") : t("c19_verify")} busy={busy} disabled={code.length !== 6} onPress={() => check(code)} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button kind="soft" label={wait > 0 ? t("c19_resend_in", { s: wait }) : t("c19_resend")} disabled={wait > 0 || busy} onPress={sendCode} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="soft" label={t("c19_change_number")} disabled={busy} onPress={() => { setStep("number"); setError(null); }} />
            </View>
          </View>
        </>
      )}

      {step === "kyc" && (
        <>
          <Insight tone="accent" icon="info" text={t("c19_kyc_body")} />
          <Txt v="caption" color="muted">{t("c19_kyc_steps")}</Txt>
          <Button label={t("c19_kyc_open")} icon="openInNew" onPress={() => openLink("https://1912.uppcl.org/")} />
          <Button kind="soft" label={t("c19_kyc_done")} onPress={() => { setStep("number"); setError(null); }} />
        </>
      )}
    </Sheet>
  );
}
