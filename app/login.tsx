import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, StatusBar } from "react-native";
import { keystore, UPPCL_SMART_URL } from "../src/boot";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createSignIn, isAlreadyRegistered, isNoAccount, isUnknownAccount, login, mutate, prepareSignIn, ProxyError,
  sendSignInCode, sendSignUpCode, signInReady, verifySignInCode, type CodeTo,
} from "@shared/api";
import { HELPLINE_TEL } from "@shared/complaints";
import { sessionWasExpired } from "@shared/session";
import { useI18n, type Lang } from "../src/i18n";
import { font, radius, useColors } from "../src/theme";
import { AppIcon, Button, Card, Glow, Insight, Txt, familyFor } from "../src/ui";
import { ErrorNote } from "../src/errors";
import { Icon, type IconName } from "../src/icons";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { openLink } from "../src/links";
import { DEMO, setScenario } from "../src/demo";

/**
 * Sign-in, three ways (UPPCL SMART, Nov 2026):
 * - a code to the mobile (or email): no password to forget, the default for a first sign-in;
 * - username + password, as before (the phone's password manager fills it, so returning password users start here);
 * - no login yet: create one from the account number on the bill (code to the mobile UPPCL has for it + a password).
 * The screen opens on whichever way worked last on this phone.
 */
type Mode = "code" | "password" | "signup";
const METHOD_KEY = "login_method"; // last way that worked here; not a secret

/** What went wrong, by what the user can do about it: fix what they typed, fix their connection, or wait on UPPCL / tell us. */
type Fail = { kind: "creds" } | { kind: "offline" } | { kind: "slow" } | { kind: "other"; error: unknown };

// UPPCL answers a bad login with 401, or 409 "Incorrect Username or Password." (see humanizeError).
const BAD_CREDS = /(invalid|incorrect) (credentials|username|password)|missing login params/i;
const RESEND_S = 30;

/** A 10-digit Indian mobile from what was typed or pasted ("+91 98…", "098…"), else null. */
function mobileOf(v: string): string | null {
  let d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
const masked = (to: CodeTo) => ("phone" in to ? `${to.phone.slice(0, 2)}••••${to.phone.slice(-3)}` : to.email.replace(/^(.).*(@.*)$/, "$1•••$2"));

function failOf(e: unknown): Fail {
  // A timeout is UPPCL being slow, not the user's internet: don't send them to check airplane mode.
  if ((e as { kind?: string }).kind === "network") return { kind: /timeout/i.test(String((e as { reason?: string }).reason)) ? "slow" : "offline" };
  if (e instanceof ProxyError && (e.status === 401 || e.status === 403 || BAD_CREDS.test(e.reason))) return { kind: "creds" };
  return { kind: "other", error: e }; // UPPCL down, captcha trouble, or our bug: ErrorNote says whose side
}
/** Which code problem UPPCL means, so each gets its own advice. */
function codeProblem(e: unknown): "wrong" | "expired" | "tooMany" | null {
  const m = e instanceof ProxyError ? e.reason : "";
  if (/too many|attempts? exceeded|limit|blocked|try (again )?(after|later)/i.test(m)) return "tooMany";
  if (/expire/i.test(m)) return "expired";
  if (/(invalid|incorrect|wrong|mismatch).*(otp|code|token)|(otp|code|token).*(invalid|incorrect|wrong)/i.test(m)) return "wrong";
  return null;
}

export default function Login() {
  const c = useColors();
  const { t, lang } = useI18n();
  const L = (lang === "hi" ? hi : en).login; // field labels shared with the web login
  const [mode, setMode] = useState<Mode>(() => (keystore.getItem(METHOD_KEY) === "password" ? "password" : "code"));
  const [expired] = useState(sessionWasExpired); // UPPCL rejected the saved session (MISS-047)
  const [forgot, setForgot] = useState<Forgot>(null); // came from "Forgot username/password?": say why it isn't needed here
  const [prefill, setPrefill] = useState("");
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, StatusBar.currentHeight ?? 0); // insets.top can be 0 right after sign-out
  useEffect(() => { void prepareSignIn(); }, []);

  const go: Go = (m, opts) => { setForgot(opts?.forgot ?? null); if (opts?.prefill !== undefined) setPrefill(opts.prefill); setMode(m); };
  /** Signed in: remember the way, then let /health swap this screen for Home. */
  const opened = async (way: "code" | "password") => { keystore.setItem(METHOD_KEY, way); await mutate("/health"); };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {/* Top edge is handled by the welcome block so its glow runs up behind the status bar. */}
      <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Welcome: the one place the brand speaks. */}
          <View style={[styles.welcome, { paddingTop: topInset + 12 }]}>
            <Glow />
            <View style={styles.topBar}>
              <View style={styles.brand}>
                <AppIcon size={40} />
                <Txt v="heading">{t("login_title")}</Txt>
              </View>
              <LangToggle />
            </View>
            <Txt v="title" style={{ marginTop: 36 }}>{mode === "signup" ? t("su_title") : t("login_headline")}</Txt>
            {mode !== "signup" && <Txt v="body" color="muted" style={{ marginTop: 6 }}>{t("login_sub")}</Txt>}
          </View>

          {expired && <Insight tone="warn" icon="schedule" text={t("session_expired")} />}

          {mode === "code" && <CodeSignIn key={prefill} prefill={prefill} forgot={forgot} onOpened={() => opened("code")} onGo={go} />}
          {mode === "password" && <PasswordSignIn onOpened={() => opened("password")} onGo={go} />}
          {mode === "signup" && <SignUp onOpened={() => opened("password")} onGo={go} />}

          {mode !== "signup" && (
            <>
              {/* Look around first: invented data, nothing is sent to UPPCL (src/demo.ts). */}
              <Pressable accessibilityRole="button" onPress={() => { setScenario(DEMO); void mutate("/health"); }} style={styles.newHere}>
                <Txt v="label" color="primary" weight="semibold">{t("try_sample")}</Txt>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => go("signup")} style={styles.newHere}>
                <Txt v="label" color="muted">{t("new_here_short")} </Txt>
                <Txt v="label" color="primary" weight="semibold">{t("si_create_with_acct")}</Txt>
              </Pressable>
            </>
          )}

          <Txt v="caption" color="muted" style={styles.footer}>{t("unofficial_short")}</Txt>
        </ScrollView>
      </SafeAreaView>
      {/* When the keyboard scrolls the form up, the header would slide under the transparent status bar and
          collide with the clock (seen on the Redmi). A solid strip keeps that area clear. */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: topInset, backgroundColor: c.bg }} />
    </KeyboardAvoidingView>
  );
}

type Forgot = "user" | "pw" | null;
type Go = (m: Mode, opts?: { forgot?: Forgot; prefill?: string }) => void;

/** Mobile (or email) → code → in. UPPCL's codes were 6 digits and are 5 since Nov 2026 (UX-R37): 4–6 are accepted;
 *  the code checks itself on the 6th digit, or when it arrives whole (SMS autofill / paste). */
function CodeSignIn({ prefill, forgot, onOpened, onGo }: { prefill: string; forgot: Forgot; onOpened: () => Promise<void>; onGo: Go }) {
  const c = useColors();
  const { t, lang } = useI18n();
  const L = (lang === "hi" ? hi : en).login;
  const [byEmail, setByEmail] = useState(false);
  const [value, setValue] = useState(prefill);
  const [to, setTo] = useState<CodeTo | null>(null); // set once the code is sent
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"sending" | "checking" | "opening" | null>(null);
  const [note, setNote] = useState<"looksAccount" | "badMobile" | "badEmail" | "noAccount" | "wrong" | "expired" | "tooMany" | null>(null);
  const [fail, setFail] = useState<Fail | null>(null);
  const [wait, setWait] = useState(0);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  function target(): CodeTo | null {
    if (byEmail) {
      if (/^\S+@\S+\.\S+$/.test(value.trim())) return { email: value.trim() };
      setNote("badEmail"); return null;
    }
    const m = mobileOf(value);
    if (m) return { phone: m };
    const d = value.replace(/\D/g, "");
    setNote(d.length === 10 ? "looksAccount" : "badMobile"); // 10 digits not starting 6–9: their account number
    return null;
  }

  async function send(again = false) {
    const dest = again ? to : target();
    if (!dest) return;
    setNote(null); setFail(null); setStage("sending");
    try { await sendSignInCode(dest); setTo(dest); setCode(""); setWait(RESEND_S); }
    catch (e) {
      if (isNoAccount(e)) setNote("noAccount");
      else if (codeProblem(e) === "tooMany") setNote("tooMany");
      else setFail(failOf(e));
    } finally { setStage(null); }
  }

  async function check(otp: string) {
    if (!to) return;
    setNote(null); setFail(null); setStage("checking");
    try {
      await verifySignInCode(to, otp);
      setStage("opening"); // stays busy until Home replaces this screen
      setTimeout(() => setStage(null), 20_000); // never spin forever if the switch doesn't come
      await onOpened();
    } catch (e) {
      setStage(null); setCode("");
      const p = codeProblem(e);
      if (p) { setNote(p); if (p === "expired") setWait(0); } // expired: resend right away, not after the timer
      else setFail(failOf(e));
    }
  }

  const input = [styles.input, { color: c.text, fontFamily: familyFor("medium", lang === "hi") }];
  const busy = stage !== null;
  const noteText = note === "noAccount" && to === null ? t("si_no_account", { to: byEmail ? value.trim() : masked({ phone: mobileOf(value) ?? value }) })
    : note === "looksAccount" ? t("si_looks_account") : note === "badMobile" ? t("si_bad_mobile") : note === "badEmail" ? t("si_bad_email")
    : note === "wrong" ? t("si_wrong_code") : note === "expired" ? t("si_expired_code") : note === "tooMany" ? t("si_too_many") : null;

  return (
    <Card style={styles.form}>
      {!!forgot && <Insight tone="accent" icon="info" text={t(forgot === "user" ? "si_forgot_user_note" : "si_forgot_note")} />}
      {!to ? (
        <>
          <Field label={byEmail ? t("si_email") : t("si_mobile")} active={focused} invalid={note === "badMobile" || note === "badEmail" || note === "looksAccount"}>
            {!byEmail && <Txt v="body" color="muted" style={{ paddingLeft: 14 }}>+91</Txt>}
            <TextInput
              style={[input, { flex: 1 }]} value={value} onChangeText={(v) => { setValue(v); setNote(null); }}
              placeholder={byEmail ? "name@example.com" : t("c19_mobile_ph")} placeholderTextColor={c.muted}
              keyboardType={byEmail ? "email-address" : "phone-pad"} autoComplete={byEmail ? "email" : "tel"}
              textContentType={byEmail ? "emailAddress" : "telephoneNumber"} autoCapitalize="none"
              accessibilityLabel={byEmail ? t("si_email") : t("si_mobile")} returnKeyType="send" onSubmitEditing={() => void send()}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            />
          </Field>
          <TextLink label={byEmail ? t("si_use_mobile") : t("si_use_email")} onPress={() => { setByEmail(!byEmail); setValue(""); setNote(null); }} />
          {noteText && <Note text={noteText} />}
          {note === "looksAccount" && <Button kind="soft" label={t("si_with_password")} onPress={() => onGo("password")} />}
          {note === "noAccount" && (
            <View style={{ gap: 8 }}>
              <Button label={t("si_create_with_acct")} onPress={() => onGo("signup")} />
              <Button kind="soft" label={t("si_with_password")} onPress={() => onGo("password")} />
            </View>
          )}
          {fail && <FailNote fail={fail} />}
          {note !== "noAccount" && <Button label={stage === "sending" ? t("si_sending") : t("si_send")} icon="sms" onPress={() => void send()} busy={busy} disabled={!value.trim()} />}
        </>
      ) : (
        <>
          {/* TalkBack would read the mask as "bullet bullet…": say "mobile ending in 4761" instead. */}
          <View accessible accessibilityLabel={"phone" in to ? t("si_sent_sms", { to: t("si_mobile_a11y", { last: to.phone.slice(-4) }) }) : undefined}>
            <Txt v="body" color="muted">{t("phone" in to ? "si_sent_sms" : "si_sent_email", { to: masked(to) })}</Txt>
          </View>
          <Field label={t("si_code")} active invalid={note === "wrong"}>
            <TextInput
              style={[input, { flex: 1, fontSize: 24, letterSpacing: 8, textAlign: "center" }]} value={code} autoFocus
              keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" importantForAutofill="yes"
              placeholderTextColor={c.muted} accessibilityLabel={t("si_code")}
              onChangeText={(v) => { const d = v.replace(/\D/g, "").slice(0, 6); const whole = d.length >= 4 && d.length - code.length > 1; setCode(d); setNote(null); if ((d.length === 6 || whole) && !busy) void check(d); }}
            />
          </Field>
          {noteText && <Note text={noteText} />}
          {note === "tooMany" && <Button kind="soft" label={t("si_with_password")} onPress={() => onGo("password")} />}
          {fail && <FailNote fail={fail} />}
          <Button label={stage === "checking" ? t("si_checking") : stage === "opening" ? t("signin_opening") : L.sign_in}
            onPress={() => void check(code)} busy={busy} disabled={code.length < 4} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button kind="soft" label={wait > 0 ? t("c19_resend_in", { s: wait }) : t("c19_resend")} disabled={wait > 0 || busy || note === "tooMany"} onPress={() => void send(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="soft" label={t("c19_change_number")} disabled={busy} onPress={() => { setTo(null); setNote(null); setFail(null); }} />
            </View>
          </View>
          {wait <= 0 && !note && <Txt v="caption" color="muted">{t("si_no_sms")}</Txt>}
          <TextLink label={t("si_reset_web")} muted onPress={() => openLink(`${UPPCL_SMART_URL}forgot-password`)} />
        </>
      )}
      <TextLink label={t("si_with_password")} onPress={() => onGo("password")} />
      <Privacy text={t("si_privacy_code")} />
    </Card>
  );
}

/** Username + password, as before. "Forgot" opens code sign-in here instead of UPPCL's website. */
function PasswordSignIn({ onOpened, onGo }: { onOpened: () => Promise<void>; onGo: Go }) {
  const c = useColors();
  const { t, lang } = useI18n();
  const L = (lang === "hi" ? hi : en).login;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  // What the button says while busy: UPPCL's sign-in check (~7 s on older phones) is worked out as soon as
  // this screen opens, so it's usually done before the user has typed their password.
  const [stage, setStage] = useState<"prep" | "signin" | "opening" | null>(null);
  const busy = stage !== null;
  const [fail, setFail] = useState<Fail | null>(null);
  const [focused, setFocused] = useState<"user" | "pw" | null>(null);
  const pwRef = useRef<TextInput>(null);
  const badCreds = fail?.kind === "creds"; // only this paints the fields red: no connection ≠ wrong password

  async function submit() {
    if (!username.trim() || !password) return;
    setFail(null);
    try {
      if (!signInReady()) { setStage("prep"); await prepareSignIn(); }
      setStage("signin");
      await login(username.trim(), password);
      setStage("opening"); // stays busy until Home replaces this screen: no idle gap in between
      setTimeout(() => setStage(null), 20_000); // never spin forever if the switch doesn't come
      await onOpened();
    } catch (e) { setStage(null); setFail(failOf(e)); }
  }

  const edited = () => { if (badCreds) setFail(null); };
  const input = [styles.input, { color: c.text, fontFamily: familyFor("medium", lang === "hi") }];
  const forgot = (which: "user" | "pw") => onGo("code", { forgot: which, prefill: mobileOf(username) ?? "" });

  return (
    <Card style={styles.form}>
      {/* Each "forgot" link sits by the field it recovers and opens code sign-in: no password needed. */}
      <Field label={L.username} link={t("forgot_username")} onLink={() => forgot("user")} active={focused === "user"} invalid={badCreds}>
        <TextInput
          style={[input, { flex: 1 }]} value={username} onChangeText={(v) => { setUsername(v); edited(); }}
          placeholder={L.username_hint} placeholderTextColor={c.muted}
          keyboardType="number-pad" autoComplete="username" textContentType="username" autoCapitalize="none"
          accessibilityLabel={L.username} returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()}
          onFocus={() => setFocused("user")} onBlur={() => setFocused(null)}
        />
      </Field>

      <Field label={L.password} link={t("forgot_password_short")} onLink={() => forgot("pw")} active={focused === "pw"} invalid={badCreds}>
        <TextInput
          ref={pwRef} style={[input, { flex: 1 }]} value={password} onChangeText={(v) => { setPassword(v); edited(); }}
          secureTextEntry={!showPw} autoComplete="current-password" textContentType="password"
          accessibilityLabel={L.password} returnKeyType="go" onSubmitEditing={submit}
          onFocus={() => setFocused("pw")} onBlur={() => setFocused(null)}
        />
        <Eye shown={showPw} onToggle={() => setShowPw((s) => !s)} />
      </Field>

      {fail && <FailNote fail={fail} />}

      <Button label={stage === "prep" ? t("signin_prep") : stage === "opening" ? t("signin_opening") : busy ? L.signing_in : L.sign_in} onPress={submit} busy={busy} disabled={!username.trim() || !password} />
      <TextLink label={t("si_with_code")} onPress={() => onGo("code")} />
      <Privacy text={t("login_privacy")} />
    </Card>
  );
}

/** No login yet: account number → code to UPPCL's mobile for it + a new password → signed in with that password. */
function SignUp({ onOpened, onGo }: { onOpened: () => Promise<void>; onGo: Go }) {
  const c = useColors();
  const { t, lang } = useI18n();
  const [account, setAccount] = useState("");
  const [sent, setSent] = useState<{ mobile: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [stage, setStage] = useState<"sending" | "creating" | "opening" | null>(null);
  const [note, setNote] = useState<"unknown" | "already" | "wrong" | "expired" | "tooMany" | null>(null);
  const [pwRefused, setPwRefused] = useState<string | null>(null);
  const [notMine, setNotMine] = useState(false);
  const [fail, setFail] = useState<Fail | null>(null);
  const pwRef = useRef<TextInput>(null);
  const busy = stage !== null;
  const input = [styles.input, { color: c.text, fontFamily: familyFor("medium", lang === "hi") }];

  async function send() {
    setNote(null); setFail(null); setStage("sending");
    try { setSent(await sendSignUpCode(account)); setCode(""); }
    catch (e) { if (isAlreadyRegistered(e)) setNote("already"); else if (isUnknownAccount(e)) setNote("unknown"); else setFail(failOf(e)); }
    finally { setStage(null); }
  }

  async function create() {
    setNote(null); setFail(null); setPwRefused(null); setStage("creating");
    try {
      await createSignIn(code, password);
      setStage("opening");
      setTimeout(() => setStage(null), 20_000);
      await login(account, password); // the new login: the account number is a SMART username
      await onOpened();
    } catch (e) {
      setStage(null);
      const p = codeProblem(e);
      if (p) { setNote(p); setCode(""); }
      // A refused password keeps the code: no new SMS for a password rule.
      else if (e instanceof ProxyError && /password/i.test(e.reason)) { setPwRefused(e.reason); setPassword(""); }
      else if (isAlreadyRegistered(e)) setNote("already");
      else setFail(failOf(e));
    }
  }

  const noteText = note === "unknown" ? t("su_unknown_acct") : note === "already" ? t("su_already") : note === "wrong" ? t("si_wrong_code")
    : note === "expired" ? t("si_expired_code") : note === "tooMany" ? t("si_too_many") : null;

  return (
    <Card style={styles.form}>
      {!sent ? (
        <>
          <Field label={t("su_account")} active invalid={note === "unknown"}>
            <TextInput
              style={[input, { flex: 1, fontSize: 20, letterSpacing: 2 }]} value={account} autoFocus keyboardType="number-pad" maxLength={10}
              placeholder="12345 67890" placeholderTextColor={c.muted} accessibilityLabel={t("su_account")}
              onChangeText={(v) => { setAccount(v.replace(/\D/g, "").slice(0, 10)); setNote(null); }} returnKeyType="send"
              onSubmitEditing={() => account.length === 10 && void send()}
            />
          </Field>
          {noteText && <Note text={noteText} />}
          {fail && <FailNote fail={fail} />}
          {note === "already" ? (
            <View style={{ gap: 8 }}>
              <Button label={t("si_with_code")} onPress={() => onGo("code")} />
              <Button kind="soft" label={t("si_with_password")} onPress={() => onGo("password")} />
            </View>
          ) : <Button label={stage === "sending" ? t("si_sending") : t("si_send")} icon="sms" onPress={() => void send()} busy={busy} disabled={account.length !== 10} />}
        </>
      ) : (
        <>
          <View accessible accessibilityLabel={sent.mobile ? t("su_sent", { to: t("si_mobile_a11y", { last: sent.mobile }) }) : undefined}>
            <Txt v="body" color="muted">{sent.mobile ? t("su_sent", { to: `••••${sent.mobile}` }) : t("su_sent_unknown")}</Txt>
          </View>
          <TextLink label={t("su_not_mine")} onPress={() => setNotMine((v) => !v)} />
          {notMine && (
            <View style={{ gap: 8 }}>
              <Insight tone="accent" icon="info" text={t("su_not_mine_body")} />
              <Button kind="soft" label={t("rp_call_1912")} icon="call" onPress={() => void Linking.openURL(`tel:${HELPLINE_TEL}`)} />
            </View>
          )}
          {/* No check on the 6th digit here: the password comes next, so the code moves focus on instead. */}
          <Field label={t("si_code")} active={false} invalid={note === "wrong"}>
            <TextInput
              style={[input, { flex: 1, fontSize: 24, letterSpacing: 8, textAlign: "center" }]} value={code} autoFocus
              keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" importantForAutofill="yes"
              placeholderTextColor={c.muted} accessibilityLabel={t("si_code")}
              onChangeText={(v) => { const d = v.replace(/\D/g, "").slice(0, 6); const whole = d.length >= 4 && d.length - code.length > 1; setCode(d); setNote(null); if (d.length === 6 || whole) pwRef.current?.focus(); }}
            />
          </Field>
          <Field label={t("su_password")} active={false} invalid={!!pwRefused}>
            <TextInput
              ref={pwRef} style={[input, { flex: 1 }]} value={password} onChangeText={(v) => { setPassword(v); setPwRefused(null); }}
              secureTextEntry={!showPw} autoComplete="new-password" textContentType="newPassword" accessibilityLabel={t("su_password")}
              returnKeyType="go" onSubmitEditing={() => code.length >= 4 && password.length >= 8 && void create()}
            />
            <Eye shown={showPw} onToggle={() => setShowPw((s) => !s)} />
          </Field>
          <View accessibilityLiveRegion="polite">
            <Txt v="caption" color={pwRefused ? "critical" : "muted"}>{pwRefused ? t("su_pw_refused", { reason: pwRefused }) : t("su_password_hint")}</Txt>
          </View>
          {noteText && <Note text={noteText} />}
          {note === "already" && <Button kind="soft" label={t("si_with_code")} onPress={() => onGo("code")} />}
          {fail && <FailNote fail={fail} />}
          <Button label={stage === "creating" ? t("si_creating") : stage === "opening" ? t("signin_opening") : t("su_create")}
            onPress={() => void create()} busy={busy} disabled={code.length < 4 || password.length < 8} />
        </>
      )}
      <TextLink label={t("su_back")} onPress={() => (sent ? setSent(null) : onGo("code"))} />
      <Privacy text={t("si_privacy_code")} />
    </Card>
  );
}

function Note({ text }: { text: string }) {
  const c = useColors();
  return (
    <View style={styles.errRow} accessibilityLiveRegion="polite">
      <Icon name="warning" size={18} color={c.warn} />
      <Txt v="label" color="text" style={{ flex: 1 }}>{text}</Txt>
    </View>
  );
}

function FailNote({ fail }: { fail: Fail }) {
  const c = useColors();
  const { t } = useI18n();
  return (
    <View accessibilityLiveRegion="polite">
      {fail.kind === "creds" ? (
        <View style={styles.errRow}>
          <Icon name="warning" size={18} color={c.critical} />
          <Txt v="label" color="critical" style={{ flex: 1 }}>{t("login_bad_credentials")}</Txt>
        </View>
      ) : fail.kind === "offline" || fail.kind === "slow" ? <Insight tone="warn" icon="warning" text={t(fail.kind === "slow" ? "login_slow" : "login_offline")} />
        : <ErrorNote error={fail.error} />}
    </View>
  );
}

/** A 48dp text button (switching mode, "forgot", "back"). */
function TextLink({ label, onPress, muted }: { label: string; onPress: () => void; muted?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.textLink}>
      <Txt v="label" color={muted ? "muted" : "primary"} weight="semibold">{label}</Txt>
    </Pressable>
  );
}

function Privacy({ text }: { text: string }) {
  const c = useColors();
  return (
    <View style={styles.privacy}>
      <Icon name="lock" size={16} color={c.muted} />
      <Txt v="caption" color="muted" style={{ flexShrink: 1 }}>{text}</Txt>
    </View>
  );
}

function Eye({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const c = useColors();
  const { lang } = useI18n();
  const L = (lang === "hi" ? hi : en).login;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={shown ? L.hide_password : L.show_password} onPress={onToggle} hitSlop={4} style={styles.eye}>
      <Icon name={(shown ? "visibilityOff" : "visibility") as IconName} size={22} color={c.muted} />
    </Pressable>
  );
}

/** Label, an optional "forgot" link on the same line, and the input box (focus ring = where typing goes). */
function Field({ label, link, onLink, active, invalid, children }: {
  label: string; link?: string; onLink?: () => void; active: boolean; invalid: boolean; children: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.labelRow}>
        <Txt v="label" color="muted" weight="semibold" style={{ flexShrink: 1 }}>{label}</Txt>
        {!!link && onLink && (
          <Pressable accessibilityRole="button" onPress={onLink} hitSlop={{ top: 10, bottom: 4, left: 12, right: 12 }} style={styles.link}>
            <Txt v="label" color="primary" weight="semibold">{link}</Txt>
          </Pressable>
        )}
      </View>
      <View style={[styles.box, {
        backgroundColor: c.bg,
        borderColor: invalid ? c.critical : active ? c.primary : c.line,
        borderWidth: invalid || active ? 2 : 1,
        paddingHorizontal: invalid || active ? 0 : 1, // keeps the text still when the ring thickens
      }]}>
        {children}
      </View>
    </View>
  );
}

/** हि | EN: both choices always visible, the current one raised. Each label is drawn in its own script's face. */
function LangToggle() {
  const c = useColors();
  const { t, lang, setLang } = useI18n();
  const opts: { value: Lang; label: string; name: string; face: string }[] = [
    { value: "hi", label: t("lang_hi_short"), name: t("hindi"), face: font.hiSemibold },
    { value: "en", label: t("lang_en_short"), name: t("english"), face: font.semibold },
  ];
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t("language")} style={[styles.toggle, { backgroundColor: c.pill }]}>
      {opts.map((o) => {
        const on = o.value === lang;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.name}
            onPress={() => setLang(o.value)} hitSlop={{ top: 8, bottom: 8 }} style={[styles.toggleItem, on && { backgroundColor: c.surface }]}>
            <Txt v="label" color={on ? "text" : "muted"} style={{ fontFamily: o.face }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  newHere: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", minHeight: 48, alignItems: "center" },
  textLink: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 1, padding: 16, gap: 16 },
  // Bleeds past the screen gutter so the glow reads as light, not as a box.
  welcome: { marginHorizontal: -16, marginTop: -16, paddingBottom: 8, paddingHorizontal: 20 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggle: { flexDirection: "row", borderRadius: radius.pill, padding: 3 },
  toggleItem: { minWidth: 44, minHeight: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  form: { gap: 16, padding: 16 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  link: { minHeight: 48, justifyContent: "center" },
  box: { borderRadius: radius.button, minHeight: 52, flexDirection: "row", alignItems: "center" },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  eye: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  errRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  privacy: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  footer: { marginTop: "auto", paddingTop: 8, textAlign: "center" },
});
