import "../src/boot"; // must be first: wires the shared API client to the phone
import "../src/alerts"; // defines the background balance check at startup
import { useEffect, useState } from "react";
import { AppState, StatusBar, useColorScheme } from "react-native";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import * as QuickActions from "expo-quick-actions";
import { useQuickActionRouting, type RouterAction } from "expo-quick-actions/router";
import * as SplashScreen from "expo-splash-screen";
import * as LocalAuthentication from "expo-local-authentication";
import * as Font from "expo-font";
import { useFonts } from "expo-font";
import { AnekLatin_400Regular, AnekLatin_500Medium, AnekLatin_600SemiBold, AnekLatin_700Bold, AnekLatin_800ExtraBold } from "@expo-google-fonts/anek-latin";
import { AnekDevanagari_400Regular, AnekDevanagari_600SemiBold, AnekDevanagari_700Bold } from "@expo-google-fonts/anek-devanagari";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useDashboard, useHealth } from "@shared/api";
import { SWRConfig, mutate } from "swr";
import { persistentCache } from "../src/cache";
import { DevBanner } from "../src/dev"; // @dev-tools
import { I18nProvider, useI18n } from "../src/i18n";
import { FINGERPRINT_KEY, keystore } from "../src/boot";
import { getThemeChoice, setThemeChoice, useColors } from "../src/theme";

setThemeChoice(getThemeChoice()); // apply the saved theme before the first frame
import { AppIcon, Button, Glow, Txt } from "../src/ui";
import { Icon } from "../src/icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "react-native";

SplashScreen.preventAutoHideAsync();

const LATIN = { AnekLatin_400Regular, AnekLatin_500Medium, AnekLatin_600SemiBold, AnekLatin_700Bold, AnekLatin_800ExtraBold };
const DEVANAGARI = { AnekDevanagari_400Regular, AnekDevanagari_600SemiBold, AnekDevanagari_700Bold };

export default function Root() {
  // Only the fonts the first screen needs block the splash; the other script loads right after (P2).
  const hindiFirst = keystore.getItem("app_lang") === "hi";
  const [loaded] = useFonts(hindiFirst ? { ...LATIN, ...DEVANAGARI } : LATIN);
  useEffect(() => {
    if (!loaded) return;
    SplashScreen.hideAsync();
    if (!hindiFirst) void Font.loadAsync(DEVANAGARI).catch(() => {}); // ready before anyone switches to Hindi
  }, [loaded, hindiFirst]);
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      {/* SWR retries failures forever by default; through a day-long UPPCL outage that keeps the radio busy.
          Three backed-off retries, then the screen's own "try again" / pull-to-refresh / next open. */}
      <SWRConfig value={{ provider: persistentCache, errorRetryCount: 3 }}>
        <I18nProvider>
          <Gate />
        </I18nProvider>
      </SWRConfig>
    </SafeAreaProvider>
  );
}

function Gate() {
  const c = useColors();
  const scheme = useColorScheme();
  const { data: health } = useHealth();
  const signedIn = health?.authenticated ?? false;
  const locked = useFingerprintLock(signedIn);

  useQuickActionRouting(); // long-press app-icon shortcuts navigate via params.href
  useAppShortcuts(signedIn);
  useNotificationTaps();

  // Instant open shows saved data; the shared hooks don't revalidate stale data on their own, so
  // refresh whatever is on screen once we're signed in.
  useEffect(() => {
    if (signedIn) void mutate((k) => typeof k === "string" && k !== "/health");
  }, [signedIn]);

  return (
    <>
      <StatusBar barStyle={scheme === "dark" ? "light-content" : "dark-content"} backgroundColor={c.bg} />
      {locked ? (
        <LockScreen onUnlock={locked.unlock} />
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: "fade" }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="settings" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="complaint/[no]" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="pdf" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="details" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="profile" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="pay" options={{ presentation: "transparentModal", animation: "fade", contentStyle: { backgroundColor: "transparent" } }} />
            <Stack.Screen name="quick/[action]" options={{ animation: "none" }} />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="login" />
          </Stack.Protected>
          {/* Last on purpose: the first unguarded screen becomes the initial route. */}
          <Stack.Screen name="web" options={{ animation: "slide_from_bottom" }} />
        </Stack>
      )}
      {__DEV__ && <DevBanner />} {/* @dev-tools */}
    </>
  );
}

/** A tapped notification opens the screen it is about (params set in src/alerts.ts). */
function useNotificationTaps() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const href = last?.notification.request.content.data?.href;
    if (typeof href === "string") router.push(href as never);
  }, [last]);
}

/** Long-press shortcuts on the app icon: the jobs people open the app for, one tap each. */
function useAppShortcuts(signedIn: boolean) {
  const { t } = useI18n();
  const { data } = useDashboard();
  const postpaid = data?.site.connectionType === "postpaid";
  useEffect(() => {
    if (!signedIn) { void QuickActions.setItems([]); return; }
    void QuickActions.setItems<RouterAction>([
      { id: "sms", title: t("qa_sms"), icon: "qa_sms", params: { href: "/quick/sms" } },
      ...(postpaid ? [{ id: "bill", title: t("qa_bill"), icon: "qa_bill", params: { href: "/quick/bill" } }] : []),
      { id: "pay", title: postpaid ? t("qa_pay") : t("qa_recharge"), icon: "qa_pay", params: { href: "/quick/pay" } },
    ]);
  }, [signedIn, postpaid, t]);
}

/** When enabled, ask for a fingerprint on cold start and after 5 min in the background. */
function useFingerprintLock(signedIn: boolean) {
  const { t } = useI18n();
  const [locked, setLocked] = useState(() => signedIn && keystore.getItem(FINGERPRINT_KEY) === "1");

  useEffect(() => {
    let leftAt = 0;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") leftAt = Date.now();
      if (s === "active" && leftAt && Date.now() - leftAt > 5 * 60_000 && keystore.getItem(FINGERPRINT_KEY) === "1") setLocked(true);
    });
    return () => sub.remove();
  }, []);

  async function unlock() {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t("unlock_prompt") });
    if (r.success) setLocked(false);
  }

  useEffect(() => { if (locked) void unlock(); }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps
  return locked && signedIn ? { unlock } : null;
}

/** Same welcome as the login screen, so unlocking feels like the same place. */
function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const c = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: c.bg, padding: 16, gap: 24 }}>
      <View style={{ marginHorizontal: -16, marginTop: -16, paddingTop: insets.top + 56, paddingBottom: 8, paddingHorizontal: 20 }}>
        <Glow />
        <AppIcon />
        <Txt v="title" style={{ marginTop: 20 }}>{t("welcome_back")}</Txt>
        <Txt v="body" color="muted" style={{ marginTop: 4 }}>{t("unlock_desc")}</Txt>
      </View>
      <View style={{ marginTop: "auto", alignItems: "center", gap: 16, paddingBottom: 12 }}>
        <Icon name="fingerprint" size={56} color={c.primary} />
        <View style={{ alignSelf: "stretch" }}><Button label={t("fingerprint")} onPress={onUnlock} /></View>
      </View>
    </SafeAreaView>
  );
}
