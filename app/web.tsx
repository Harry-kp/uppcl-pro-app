import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useColors } from "../src/theme";
import { BackHeader } from "../src/ui";

/** A web page inside the app, for phones with no browser (see src/links.ts). */
export default function WebPage() {
  const c = useColors();
  const { url } = useLocalSearchParams<{ url: string }>();
  const [loading, setLoading] = useState(true);
  const host = (() => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; } })();
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.head}><BackHeader title={host} /></View>
      <View style={{ flex: 1, marginTop: 8 }}>
        <WebView source={{ uri: url }} onLoadEnd={() => setLoading(false)} style={{ backgroundColor: c.bg }} />
        {loading && <View style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator color={c.primary} /></View>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingTop: 8 },
  center: { alignItems: "center", justifyContent: "center" },
});
