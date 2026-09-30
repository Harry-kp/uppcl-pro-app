import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useColors } from "../src/theme";
import { isInAppUrl } from "../src/links";
import { useI18n } from "../src/i18n";
import { BackHeader, Txt } from "../src/ui";

/** A web page inside the app, for phones with no browser (see src/links.ts). */
export default function WebPage() {
  const c = useColors();
  const { t } = useI18n();
  const { url } = useLocalSearchParams<{ url: string }>();
  const [loading, setLoading] = useState(true);
  const ok = isInAppUrl(url);
  const host = ok ? new URL(url).host.replace(/^www\./, "") : "";
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.head}><BackHeader title={host} /></View>
      {!ok ? <View style={styles.center}><Txt v="body" color="muted">{t("link_blocked")}</Txt></View> : <View style={{ flex: 1, marginTop: 8 }}>
        <WebView source={{ uri: url }} onLoadEnd={() => setLoading(false)} style={{ backgroundColor: c.bg }} />
        {loading && <View style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator color={c.primary} /></View>}
      </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
