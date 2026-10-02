import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Sharing from "expo-sharing";
import Pdf from "react-native-pdf";
import { useI18n } from "../src/i18n";
import { useColors } from "../src/theme";
import { Spinner, BackHeader, Button, Txt } from "../src/ui";

/** Official UPPCL PDFs (bill, receipt, arrears) shown in-app; share/save is one tap. */
export default function PdfViewer() {
  const c = useColors();
  const { t } = useI18n();
  const { uri, name } = useLocalSearchParams<{ uri: string; name: string }>();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Filenames come from shared/api.ts: uppcl-bill-*, uppcl-receipt-*, uppcl-arrears-*.
  const title = name?.startsWith("uppcl-receipt") ? t("pdf_receipt")
    : name?.startsWith("uppcl-arrears") ? t("pdf_arrears")
    : t("pdf_bill");

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={styles.head}><BackHeader title={title} /></View>
      <View style={[styles.page, { backgroundColor: c.track }]}>
        {failed ? (
          <View style={styles.center}><Txt v="body" color="muted">{t("pdf_error")}</Txt></View>
        ) : (
          <Pdf
            source={{ uri }}
            style={styles.pdf}
            trustAllCerts={false}
            onLoadComplete={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
        {!loaded && !failed && <View style={[styles.center, StyleSheet.absoluteFill]}><Spinner size={28} /></View>}
      </View>
      <View style={styles.foot}>
        <Button label={t("share")} kind="soft" onPress={() => Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title })} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 16, paddingTop: 8 },
  page: { flex: 1, marginTop: 8 },
  pdf: { flex: 1, backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  foot: { padding: 16 },
});
