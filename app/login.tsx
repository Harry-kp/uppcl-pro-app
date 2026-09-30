import { useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { UPPCL_SMART_URL } from "../src/boot";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { mutate } from "swr";
import { login } from "@shared/api";
import { sessionWasExpired } from "@shared/session";
import { useI18n } from "../src/i18n";
import { font, radius, useColors } from "../src/theme";
import { AppIcon, Button, Glow, Insight, Txt, familyFor } from "../src/ui";
import { Icon } from "../src/icons";
import en from "../messages/en.json";
import hi from "../messages/hi.json";

export default function Login() {
  const c = useColors();
  const { t, lang, setLang } = useI18n();
  const L = (lang === "hi" ? hi : en).login; // field labels shared with the web login
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false); // no connection ≠ wrong password: don't paint the fields red
  const [expired] = useState(sessionWasExpired); // UPPCL rejected the saved session (MISS-047)
  const pwRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();

  async function submit() {
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    setOffline(false);
    try {
      await login(username.trim(), password);
      await mutate("/health");
    } catch (e) {
      const kind = (e as { kind?: string }).kind;
      if (kind === "network") { setOffline(true); setError(t("login_offline")); }
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = [styles.field, { backgroundColor: c.surface, borderColor: error && !offline ? c.critical : c.line }];
  const input = [styles.input, { color: c.text, fontFamily: familyFor("medium", lang === "hi") }];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {/* Top edge is handled by the welcome block so its glow runs up behind the status bar. */}
      <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Welcome: the one place the brand speaks. */}
          <View style={[styles.welcome, { paddingTop: insets.top + 56 }]}>
            <Glow />
            <Pressable accessibilityRole="button" accessibilityLabel={t("language")}
              onPress={() => setLang(lang === "hi" ? "en" : "hi")} hitSlop={10} style={[styles.lang, { top: insets.top + 8 }]}>
              <Txt v="label" color="primary" style={{ fontFamily: lang === "hi" ? font.semibold : font.hiSemibold }}>
                {lang === "hi" ? t("english") : t("hindi")}
              </Txt>
            </Pressable>
            <AppIcon />
            <Txt v="title" style={{ marginTop: 20 }}>{t("login_headline")}</Txt>
            <Txt v="body" color="muted" style={{ marginTop: 4 }}>{t("login_sub")}</Txt>
          </View>

          {/* Form */}
          <View style={{ gap: 14 }}>
            {expired && !error && <Insight tone="warn" icon="schedule" text={t("session_expired")} />}
            <View style={{ gap: 6 }}>
              <Txt v="label" color="muted">{L.username}</Txt>
              <View style={field}>
                <TextInput
                  style={input} value={username} onChangeText={setUsername}
                  placeholder={L.username_hint} placeholderTextColor={c.muted}
                  keyboardType="number-pad" autoComplete="username" textContentType="username" autoCapitalize="none"
                  accessibilityLabel={L.username} returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()}
                />
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Txt v="label" color="muted">{L.password}</Txt>
              <View style={[field, styles.row]}>
                <TextInput
                  ref={pwRef} style={[input, { flex: 1 }]} value={password} onChangeText={setPassword}
                  secureTextEntry={!showPw} autoComplete="current-password" textContentType="password"
                  accessibilityLabel={L.password} returnKeyType="go" onSubmitEditing={submit}
                />
                <Pressable accessibilityRole="button" accessibilityLabel={showPw ? L.hide_password : L.show_password}
                  onPress={() => setShowPw((s) => !s)} hitSlop={10} style={styles.eye}>
                  <Icon name={showPw ? "visibilityOff" : "visibility"} size={22} color={c.muted} />
                </Pressable>
              </View>
            </View>

            {error && (offline
              ? <Insight tone="warn" icon="warning" text={error} />
              : <Txt v="label" color="critical">{error}</Txt>)}

            <Button label={busy ? L.signing_in : L.sign_in} onPress={submit} busy={busy} disabled={!username.trim() || !password} />
            {/* Resets and sign-ups happen on UPPCL's own site, straight to the right page: we never handle passwords beyond sign-in. */}
            <View style={styles.links}>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${UPPCL_SMART_URL}forgot-password`)} style={styles.forgot}>
                <Txt v="label" color="primary" weight="semibold">{t("forgot_password_short")}</Txt>
              </Pressable>
              <Txt v="label" color="muted">·</Txt>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${UPPCL_SMART_URL}forgot-username`)} style={styles.forgot}>
                <Txt v="label" color="primary" weight="semibold">{t("forgot_username")}</Txt>
              </Pressable>
            </View>

            {/* First-time users often have no UPPCL SMART login yet: tell them what it is and where to get one. */}
            <View style={[styles.newUser, { backgroundColor: c.pill }]}>
              <Txt v="body" weight="semibold">{t("no_account_title")}</Txt>
              <Txt v="caption" color="muted">{t("no_account_body")}</Txt>
              <Button label={t("no_account_cta")} kind="soft" onPress={() => Linking.openURL(`${UPPCL_SMART_URL}signup`)} />
            </View>

            <View style={styles.privacy}>
              <Icon name="lock" size={16} color={c.muted} />
              <Txt v="caption" color="muted" style={{ flex: 1 }}>{t("login_privacy")}</Txt>
            </View>
          </View>

          <Txt v="caption" color="muted" style={styles.footer}>{t("unofficial_short")}</Txt>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: 16, gap: 24 },
  // Bleeds past the screen gutter so the glow reads as light, not as a box.
  welcome: { marginHorizontal: -16, marginTop: -16, paddingBottom: 8, paddingHorizontal: 20 },
  lang: { position: "absolute", right: 12, minHeight: 32, justifyContent: "center", paddingHorizontal: 8 },
  field: { borderWidth: 1, borderRadius: radius.button, minHeight: 52, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  eye: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  forgot: { minHeight: 48, justifyContent: "center", alignSelf: "center" },
  links: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, flexWrap: "wrap" },
  newUser: { borderRadius: 16, padding: 14, gap: 8 },
  privacy: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  footer: { marginTop: "auto", textAlign: "center" },
});
