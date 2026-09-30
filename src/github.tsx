/**
 * The app ships through GitHub Releases, not a store, so two things a store would do live here:
 *  - update check: is there a newer release than this build? (sideloaded APKs never update themselves)
 *  - report a problem: open a pre-filled GitHub issue (the user reviews it in the browser first).
 */
import { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import useSWR from "swr";
import Constants from "expo-constants";
import { keystore } from "./boot";
import { useI18n } from "./i18n";
import { useColors } from "./theme";
import { Button, Txt } from "./ui";
import { Icon } from "./icons";

export const REPO = "Harry-kp/uppcl-pro-app";
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
const SKIP_KEY = "app_update_skipped"; // the version the user said "Later" to

/** "0.1.10" > "0.1.9"; ignores a leading "v" and any "-beta" suffix. */
export function isNewer(latest: string, current: string): boolean {
  const n = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((x) => Number(x) || 0);
  const [a, b] = [n(latest), n(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

type Release = { version: string; apkUrl: string | null; pageUrl: string };

async function latestRelease(): Promise<Release | null> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
  if (!r.ok) return null; // no release yet, or rate-limited: say nothing
  const j = (await r.json()) as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] };
  if (!j.tag_name) return null;
  const apk = j.assets?.find((a) => a.name.endsWith(".apk"));
  return { version: j.tag_name.replace(/^v/, ""), apkUrl: apk?.browser_download_url ?? null, pageUrl: j.html_url ?? `https://github.com/${REPO}/releases` };
}

/** The newer release, if any. Checked at most every 12 h; never blocks anything. */
export function useUpdate() {
  const { data } = useSWR("github:latest", latestRelease, { dedupingInterval: 12 * 3600_000, revalidateOnFocus: false, shouldRetryOnError: false });
  return data && isNewer(data.version, APP_VERSION) ? data : null;
}

/** Home card: shown for a newer release until the user updates or says "Later" to that version. */
export function UpdateCard() {
  const c = useColors();
  const { t } = useI18n();
  const update = useUpdate();
  const [skipped, setSkipped] = useState(() => keystore.getItem(SKIP_KEY));
  if (!update || skipped === update.version) return null;
  return (
    <View style={[styles.card, { backgroundColor: c.pill }]}>
      <View style={styles.head}>
        <Icon name="download" size={20} color={c.primary} />
        <Txt v="body" weight="semibold" style={{ flex: 1 }}>{t("update_available", { v: update.version })}</Txt>
      </View>
      <Txt v="caption" color="muted">{t("update_desc")}</Txt>
      <View style={styles.actions}>
        <View style={{ flex: 1 }}><Button label={t("update_now")} onPress={() => Linking.openURL(update.apkUrl ?? update.pageUrl)} /></View>
        <Pressable accessibilityRole="button" onPress={() => { keystore.setItem(SKIP_KEY, update.version); setSkipped(update.version); }} style={styles.later}>
          <Txt v="label" color="primary" weight="semibold">{t("later")}</Txt>
        </Pressable>
      </View>
    </View>
  );
}

/** A pre-filled GitHub issue. `details` are the lines from an error's Details, if any. */
export function reportProblem(details: string[] = []) {
  const device = Platform.OS === "android" ? `${(Platform.constants as { Model?: string }).Model ?? "Android"} · Android API ${Platform.Version}` : `${Platform.OS} ${Platform.Version}`;
  const body = [
    "**What happened?**", "", "", "**What did you expect?**", "", "",
    "**Details** (from the app)", "```", ...details, `UPPCL Pro ${APP_VERSION}`, device, "```", "",
    "_Please remove anything personal (account number, phone, address) before submitting — issues are public._",
  ].join("\n");
  const title = details.length ? `Error: ${details.find((l) => /said|Error/.test(l)) ?? details[0]}`.slice(0, 120) : "";
  void Linking.openURL(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`);
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 12, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  later: { minHeight: 48, paddingHorizontal: 16, justifyContent: "center" },
});
