import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, StatusBar } from "react-native";
import { UPPCL_SMART_URL } from "../src/boot";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { login, mutate, prepareSignIn, ProxyError, signInReady } from "@shared/api";
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

/** What went wrong, by what the user can do about it: fix what they typed, fix their connection, or wait on UPPCL / tell us. */
type Fail = { kind: "creds" } | { kind: "offline" } | { kind: "slow" } | { kind: "other"; error: unknown };

// UPPCL answers a bad login with 401, or 409 "Incorrect Username or Password." (see humanizeError).
const BAD_CREDS = /(invalid|incorrect) (credentials|username|password)|missing login params/i;

export default function Login() {
  const c = useColors();
  const { t, lang } = useI18n();
  const L = (lang === "hi" ? hi : en).login; // field labels shared with the web login
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  // What the button says while busy: UPPCL's sign-in check (~7 s on older phones) is worked out as soon as
  // this screen opens, so it's usually done before the user has typed their password.
  const [stage, setStage] = useState<"prep" | "signin" | "opening" | null>(null);
  const busy = stage !== null;
  useEffect(() => { void prepareSignIn(); }, []);
  const [fail, setFail] = useState<Fail | null>(null);
  const [focused, setFocused] = useState<"user" | "pw" | null>(null);
  const [expired] = useState(sessionWasExpired); // UPPCL rejected the saved session (MISS-047)
  const pwRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, StatusBar.currentHeight ?? 0); // insets.top can be 0 right after sign-out
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
      await mutate("/health");
    } catch (e) {
      setStage(null);
      // A timeout is UPPCL being slow, not the user's internet: don't send them to check airplane mode.
      if ((e as { kind?: string }).kind === "network") setFail({ kind: /timeout/i.test(String((e as { reason?: string }).reason)) ? "slow" : "offline" });
      else if (e instanceof ProxyError && (e.status === 401 || e.status === 403 || BAD_CREDS.test(e.reason))) setFail({ kind: "creds" });
      else setFail({ kind: "other", error: e }); // UPPCL down, captcha trouble, or our bug: ErrorNote says whose side
    }
  }

  const edited = () => { if (badCreds) setFail(null); };
  const input = [styles.input, { color: c.text, fontFamily: familyFor("medium", lang === "hi") }];

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
            <Txt v="title" style={{ marginTop: 36 }}>{t("login_headline")}</Txt>
            <Txt v="body" color="muted" style={{ marginTop: 6 }}>{t("login_sub")}</Txt>
          </View>

          {expired && !fail && <Insight tone="warn" icon="schedule" text={t("session_expired")} />}

          {/* Form. Each "forgot" link sits by the field it recovers; resets happen on UPPCL's own site. */}
          <Card style={styles.form}>
            <Field label={L.username} link={t("forgot_username")} url={`${UPPCL_SMART_URL}forgot-username`}
              active={focused === "user"} invalid={badCreds}>
              <TextInput
                style={[input, { flex: 1 }]} value={username} onChangeText={(v) => { setUsername(v); edited(); }}
                placeholder={L.username_hint} placeholderTextColor={c.muted}
                keyboardType="number-pad" autoComplete="username" textContentType="username" autoCapitalize="none"
                accessibilityLabel={L.username} returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()}
                onFocus={() => setFocused("user")} onBlur={() => setFocused(null)}
              />
            </Field>

            <Field label={L.password} link={t("forgot_password_short")} url={`${UPPCL_SMART_URL}forgot-password`}
              active={focused === "pw"} invalid={badCreds}>
              <TextInput
                ref={pwRef} style={[input, { flex: 1 }]} value={password} onChangeText={(v) => { setPassword(v); edited(); }}
                secureTextEntry={!showPw} autoComplete="current-password" textContentType="password"
                accessibilityLabel={L.password} returnKeyType="go" onSubmitEditing={submit}
                onFocus={() => setFocused("pw")} onBlur={() => setFocused(null)}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={showPw ? L.hide_password : L.show_password}
                onPress={() => setShowPw((s) => !s)} hitSlop={4} style={styles.eye}>
                <Icon name={showPw ? "visibilityOff" : "visibility"} size={22} color={c.muted} />
              </Pressable>
            </Field>

            {fail && (
              <View accessibilityLiveRegion="polite">
                {fail.kind === "creds" ? (
                  <View style={styles.errRow}>
                    <Icon name="warning" size={18} color={c.critical} />
                    <Txt v="label" color="critical" style={{ flex: 1 }}>{t("login_bad_credentials")}</Txt>
                  </View>
                ) : fail.kind === "offline" || fail.kind === "slow" ? <Insight tone="warn" icon="warning" text={t(fail.kind === "slow" ? "login_slow" : "login_offline")} />
                  : <ErrorNote error={fail.error} />}
              </View>
            )}

            <Button label={stage === "prep" ? t("signin_prep") : stage === "opening" ? t("signin_opening") : busy ? L.signing_in : L.sign_in} onPress={submit} busy={busy} disabled={!username.trim() || !password} />
            <View style={styles.privacy}>
              <Icon name="lock" size={16} color={c.muted} />
              <Txt v="caption" color="muted" style={{ flexShrink: 1 }}>{t("login_privacy")}</Txt>
            </View>
          </Card>

          {/* One line for first-time users (no UPPCL SMART login yet) instead of a card: the screen's job is signing in. */}
          {/* Look around first: invented data, nothing is sent to UPPCL (src/demo.ts). */}
          <Pressable accessibilityRole="button" onPress={() => { setScenario(DEMO); void mutate("/health"); }} style={styles.newHere}>
            <Txt v="label" color="primary" weight="semibold">{t("try_sample")}</Txt>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => openLink(`${UPPCL_SMART_URL}signup`)} style={styles.newHere}>
            <Txt v="label" color="muted">{t("new_here")} </Txt>
            <Txt v="label" color="primary" weight="semibold">{t("new_here_cta")}</Txt>
          </Pressable>

          <Txt v="caption" color="muted" style={styles.footer}>{t("unofficial_short")}</Txt>
        </ScrollView>
      </SafeAreaView>
      {/* When the keyboard scrolls the form up, the header would slide under the transparent status bar and
          collide with the clock (seen on the Redmi). A solid strip keeps that area clear. */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: topInset, backgroundColor: c.bg }} />
    </KeyboardAvoidingView>
  );
}

/** Label, a "forgot" link on the same line, and the input box (focus ring = where typing goes). */
function Field({ label, link, url, active, invalid, children }: {
  label: string; link: string; url: string; active: boolean; invalid: boolean; children: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.labelRow}>
        <Txt v="label" color="muted" weight="semibold" style={{ flexShrink: 1 }}>{label}</Txt>
        <Pressable accessibilityRole="link" onPress={() => openLink(url)} hitSlop={{ top: 10, bottom: 4, left: 12, right: 12 }} style={styles.link}>
          <Txt v="label" color="primary" weight="semibold">{link}</Txt>
        </Pressable>
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
  scroll: { flexGrow: 1, padding: 16, gap: 16 },
  // Bleeds past the screen gutter so the glow reads as light, not as a box.
  welcome: { marginHorizontal: -16, marginTop: -16, paddingBottom: 8, paddingHorizontal: 20 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggle: { flexDirection: "row", borderRadius: radius.pill, padding: 3 },
  toggleItem: { minWidth: 44, minHeight: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  form: { gap: 16, padding: 16 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  link: { minHeight: 34, justifyContent: "center" },
  box: { borderRadius: radius.button, minHeight: 52, flexDirection: "row", alignItems: "center" },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  eye: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  errRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: -4 },
  privacy: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  footer: { marginTop: "auto", paddingTop: 8, textAlign: "center" },
});
