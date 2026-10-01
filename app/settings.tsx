import { useEffect, useState, type ReactNode } from "react";
import { Alert, AppState, Pressable, StyleSheet, Switch, TextInput, View, Platform } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import * as LocalAuthentication from "expo-local-authentication";
import * as Clipboard from "expo-clipboard";
import { mutate } from "swr";
import { logout, useDashboard, useMe } from "@shared/api";
import { FINGERPRINT_KEY, keystore, NAME_KEY } from "../src/boot";
import { alertsEnabled, disableAlerts, enableAlerts, getBudget, sendTestNotification, setBudget } from "../src/alerts";
import { clearSnapshot, WIDGET_NAME } from "../src/widget";
import { getWidgetInfo, requestPinWidget } from "react-native-android-widget";
import { clearPersistentCache } from "../src/cache";
import { APP_VERSION, REPO, reportProblem, useUpdate } from "../src/github";
import { DevSettingsSection } from "../src/dev"; // @dev-tools
import { useI18n } from "../src/i18n";
import { font, getThemeChoice, setThemeChoice, useColors, type ThemeChoice } from "../src/theme";
import { BackHeader, Button, Card, Choices, Screen, Sheet, Txt, familyFor } from "../src/ui";
import { rupees } from "@shared/utils";
import { Icon, type IconName } from "../src/icons";
import { openLink } from "../src/links";

export default function Settings() {
  const c = useColors();
  const { t, lang, setLang, locale } = useI18n();
  const { data: me } = useMe();
  const { data: dash } = useDashboard();
  const postpaid = dash?.site.connectionType === "postpaid";
  const [canBio, setCanBio] = useState(false);
  const [bio, setBio] = useState(() => keystore.getItem(FINGERPRINT_KEY) === "1");
  const [alerts, setAlerts] = useState(alertsEnabled);
  const [askPw, setAskPw] = useState(false);
  const [pw, setPw] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const [sheet, setSheet] = useState<"lang" | "theme" | "budget" | null>(null);
  const update = useUpdate();
  const [widgetPlaced, setWidgetPlaced] = useState(false);
  const [, rerender] = useState(0);
  useEffect(() => { if (!sheet) rerender((n) => n + 1); }, [sheet]); // budget value after its sheet closes

  // Android adds a new copy each time it's asked, so show "On home screen" instead (user bug: widget added twice).
  const checkWidget = () => void getWidgetInfo(WIDGET_NAME).then((w) => setWidgetPlaced(w.length > 0)).catch(() => {});
  useEffect(() => {
    checkWidget();
    const sub = AppState.addEventListener("change", (st) => st === "active" && checkWidget()); // back from the pin dialog
    return () => sub.remove();
  }, []);
  function addWidget() {
    void requestPinWidget({ widgetName: WIDGET_NAME });
  }

  useEffect(() => {
    void Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(([h, e]) => setCanBio(h && e));
  }, []);

  async function toggleBio(on: boolean) {
    if (on) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: t("fingerprint") });
      if (!r.success) return;
    }
    keystore.setItem(FINGERPRINT_KEY, on ? "1" : "0");
    setBio(on);
  }

  async function toggleAlerts(on: boolean) {
    setAlertError(null);
    if (on) return setAskPw(true);
    await disableAlerts();
    setAlerts(false);
  }

  async function confirmAlerts() {
    const username = me?.data?.[0]?.username;
    if (!username) return;
    setAlertBusy(true);
    try {
      const ok = await enableAlerts(username, pw);
      setPw("");
      setAskPw(false);
      setAlerts(ok);
      if (!ok) setAlertError(t("alerts_denied"));
    } catch (e) {
      setAlertError((e as Error).message); // wrong password: keep the field open to retry
    } finally {
      setAlertBusy(false);
    }
  }

  async function signOut() {
    await disableAlerts();
    await logout();
    await mutate(() => true, undefined, { revalidate: false }); // drop every cached response
    clearPersistentCache(); // and the copy kept for instant open
    clearSnapshot(); // widget shows "Open UPPCL Pro to set up"
    keystore.removeItem(NAME_KEY); // the next person to sign in isn't greeted with this name
    // The sign-in gate (_layout) swaps to the sign-in screen when /health flips. Navigating by hand as well
    // raced it: router.replace("/") could land on Home with no session ("Please sign in again" + Try again).
    await mutate("/health");
  }

  const budget = getBudget();
  const alertsLabel = postpaid ? t("alerts_post") : t("alerts");
  const langLabel = lang === "hi" ? t("hindi") : t("english");
  const themeLabel = t(theme === "light" ? "theme_light" : theme === "dark" ? "theme_dark" : "theme_system");

  return (
    <Screen>
      <BackHeader title={t("settings_title")} />

      {/* Every item is one row with its current value on the right; changes open a small sheet. */}
      {dash && (
        <Group title={t("your_connection")}>
          <Detail first lead label={t("account_no")} value={String(dash.site.connectionId)} copy
            sub={`${discomName(String(dash.site.tenantId))} · ${dash.site.connectionType === "postpaid" ? t("postpaid") : t("prepaid")}`} />
          <Row icon="person" label={t("your_details")} onPress={() => router.push("/profile")} />
          {/* Advanced observability lives on its own screen, not here. */}
          <Row icon="info" label={t("more_details")} onPress={() => router.push("/details")} />
        </Group>
      )}

      {dash && (
        <Group title={t("alerts_section")}>
          <Row first icon="notifications" label={alertsLabel}
            right={<Switch value={alerts} onValueChange={toggleAlerts} trackColor={{ true: c.primary, false: c.track }} thumbColor={c.surface} accessibilityLabel={alertsLabel} />} />
          <Row icon="savings" label={t("budget_title")} value={budget ? `₹${rupees(budget, { decimals: 0 })}` : t("off")} onPress={() => setSheet("budget")} />
          {alerts && (
            <Row icon="chat" label={t("test_btn")}
              onPress={async () => { if (!(await sendTestNotification())) setAlertError(t("alerts_denied")); }} />
          )}
        </Group>
      )}
      {alertError && <Txt v="caption" color="critical">{alertError}</Txt>}

      <Group title={t("app_section")}>
        <Row first icon="language" label={t("language")} value={langLabel} onPress={() => setSheet("lang")} />
        <Row icon="darkMode" label={t("theme")} value={themeLabel} onPress={() => setSheet("theme")} />
        {canBio && (
          <Row icon="fingerprint" label={t("fingerprint")}
            right={<Switch value={bio} onValueChange={toggleBio} trackColor={{ true: c.primary, false: c.track }} thumbColor={c.surface} accessibilityLabel={t("fingerprint")} />} />
        )}
        {/* Home-screen widgets are Android-only for now. */}
        {Platform.OS === "android" && <Row icon="widgets" label={t("widget_row")} value={widgetPlaced ? t("widget_on") : undefined} valueTone={widgetPlaced ? "ok" : undefined}
          onPress={widgetPlaced ? undefined : addWidget} />}
      </Group>

      {/* Destructive action on its own, away from preferences (UX-027). */}
      <Group title={t("account")}>
        <Row first icon="logout" label={t("sign_out")} tone="critical"
          onPress={() => Alert.alert(t("signout_title"), t("signout_body"), [
            { text: t("cancel"), style: "cancel" },
            { text: t("signout_confirm"), style: "destructive", onPress: () => void signOut() },
          ])} />
      </Group>

      {__DEV__ && <DevSettingsSection />} {/* @dev-tools */}

      <Group title={t("about")}>
        <Row first icon={update ? "download" : "checkCircle"} label={t("version", { v: APP_VERSION })}
          value={update ? t("update_available", { v: update.version }) : t("up_to_date")} valueTone={update ? undefined : "ok"}
          onPress={update ? () => openLink(update.apkUrl ?? update.pageUrl) : undefined} />
        <Row icon="chat" label={t("report_problem")} onPress={() => reportProblem()} />
        <Row icon="info" label={t("source")} onPress={() => openLink(`https://github.com/${REPO}`)} />
      </Group>
      <Txt v="caption" color="muted" style={{ marginTop: 4 }}>{t("unofficial")}</Txt>

      <Sheet visible={sheet === "lang"} title={t("language")} onClose={() => setSheet(null)}>
        <Choices value={lang} onChange={(v) => { setLang(v); setSheet(null); }} options={[{ value: "en", label: t("english") }, { value: "hi", label: t("hindi") }]} />
      </Sheet>
      <Sheet visible={sheet === "theme"} title={t("theme")} onClose={() => setSheet(null)}>
        <Choices value={theme} onChange={(v) => { setThemeChoice(v); setTheme(v); setSheet(null); }}
          options={[{ value: "system", label: t("theme_system") }, { value: "light", label: t("theme_light") }, { value: "dark", label: t("theme_dark") }]} />
      </Sheet>
      <BudgetSheet visible={sheet === "budget"} onClose={() => setSheet(null)} />
      {/* Turning reminders on needs the password (kept encrypted so the check can sign in while the app is closed). */}
      <Sheet visible={askPw} title={alertsLabel} onClose={() => { setAskPw(false); setPw(""); }}>
        <Txt v="label" color="muted">{postpaid ? t("alerts_post_desc") : t("alerts_desc")}</Txt>
        <Txt v="caption" color="muted">{t("alerts_password")}</Txt>
        <TextInput
          value={pw} onChangeText={setPw} secureTextEntry autoComplete="current-password" autoFocus
          accessibilityLabel={alertsLabel} placeholder="••••••••" placeholderTextColor={c.muted}
          style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.line, fontFamily: familyFor("medium", lang === "hi") }]}
        />
        {alertError && <Txt v="caption" color="critical">{alertError}</Txt>}
        <Button label={t("alerts_turn_on")} onPress={confirmAlerts} busy={alertBusy} disabled={!pw} />
      </Sheet>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Txt v="heading">{title}</Txt>
      <Card style={{ padding: 0, gap: 0 }}>{children}</Card>
    </View>
  );
}

/** One settings row: icon, name, current value on the right, then a chevron (tappable) or a control. */
function Row({ icon, label, value, valueTone, right, onPress, first, tone }: {
  icon: IconName; label: string; value?: string; valueTone?: "ok"; right?: ReactNode; onPress?: () => void; first?: boolean; tone?: "critical";
}) {
  const c = useColors();
  const body = (
    <>
      <Icon name={icon} size={20} color={tone ? c.critical : c.primary} />
      <Txt v="body" weight="semibold" color={tone} style={{ flex: 1 }}>{label}</Txt>
      {value !== undefined && (
        <View style={styles.value}>
          {valueTone && <Icon name="checkCircle" size={16} color={c.ok} />}
          <Txt v="label" color={valueTone ?? "muted"} numeric>{value}</Txt>
        </View>
      )}
      {right ?? (onPress && !tone ? <Icon name="chevronRight" size={20} color={c.muted} /> : null)}
    </>
  );
  const style = [styles.detail, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }];
  return onPress
    ? <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress} style={({ pressed }) => [...style, pressed && { backgroundColor: c.bg }]}>{body}</Pressable>
    : <View style={style}>{body}</View>;
}

/** One number the user picks; "Turn off" clears it. Saved on the phone, checked by the alert task. */
function BudgetSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { t, lang } = useI18n();
  const [v, setV] = useState(() => String(getBudget() ?? ""));
  useEffect(() => { if (visible) setV(String(getBudget() ?? "")); }, [visible]);
  const save = (n: number | null) => { setBudget(n); onClose(); };
  return (
    <Sheet visible={visible} title={t("budget_title")} onClose={onClose}>
      <Txt v="label" color="muted">{t("budget_desc")}</Txt>
      <View style={styles.budgetRow}>
        <Txt v="value" color="muted">₹</Txt>
        <TextInput value={v} onChangeText={(x) => setV(x.replace(/[^0-9]/g, "").slice(0, 6))} autoFocus
          keyboardType="number-pad" placeholder={t("budget_ph")} placeholderTextColor={c.muted} accessibilityLabel={t("budget_title")}
          onSubmitEditing={() => save(Number(v) || null)}
          style={[styles.input, { flex: 1, color: c.text, backgroundColor: c.bg, borderColor: c.line, fontFamily: familyFor("medium", lang === "hi") }]} />
      </View>
      <Button label={t("save")} onPress={() => save(Number(v) || null)} disabled={!Number(v)} />
      {getBudget() !== null && <Button label={t("turn_off")} kind="soft" onPress={() => save(null)} />}
    </Sheet>
  );
}

/** UPPCL's five discoms. site.tenantId is the short code (e.g. "pvvnl"); tenantCode is an internal id. */
const DISCOMS: Record<string, string> = {
  PVVNL: "Paschimanchal (PVVNL)", MVVNL: "Madhyanchal (MVVNL)", DVVNL: "Dakshinanchal (DVVNL)",
  PUVVNL: "Purvanchal (PuVVNL)", KESCO: "KESCo, Kanpur",
};
function discomName(tenantId: string): string {
  const code = tenantId.toUpperCase();
  return DISCOMS[code] ?? code;
}

/** A label/value row; `copy` adds a Copy button (e.g. the account number, needed to pay elsewhere). */
function Detail({ label, value, copy, first, sub, lead, lines = 1 }: { label: string; value: string; copy?: boolean; first?: boolean; sub?: string; lead?: boolean; lines?: number }) {
  const c = useColors();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <View style={[styles.detail, lead && { paddingVertical: 16 }, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
      {lead && <View style={[styles.lead, { backgroundColor: c.pill }]}><Icon name="bolt" size={24} color={c.primary} /></View>}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="caption" color="muted">{label}</Txt>
        <Txt v={lead ? "value" : "body"} numeric weight={lead ? undefined : "semibold"} numberOfLines={lines}>{value}</Txt>
        {sub && <Txt v="caption" color="muted" numberOfLines={2}>{sub}</Txt>}
      </View>
      {copy && (
        <Pressable accessibilityRole="button" accessibilityLabel={`${t("copy")} ${label}`} style={[styles.copy, { backgroundColor: c.pill }]}
          onPress={async () => { await Clipboard.setStringAsync(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <Txt v="label" color="pillText" weight="bold">{copied ? t("copied") : t("copy")}</Txt>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  value: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "45%" },
  detail: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  budgetRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  lead: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  copy: { borderRadius: 999, paddingHorizontal: 16, minHeight: 48, minWidth: 80, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, minHeight: 50 },
});
