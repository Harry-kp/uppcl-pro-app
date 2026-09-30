/** "Your details": what UPPCL has on record for this connection. Read-only in this app for now. */
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useDashboard, useMe, useWssConsumer } from "@shared/api";
import { ErrorNote } from "../src/errors";
import { useI18n } from "../src/i18n";
import { useColors } from "../src/theme";
import { BackHeader, Card, Insight, Screen, Txt } from "../src/ui";
import { Icon } from "../src/icons";
import { openLink } from "../src/links";

/** Official consumer portal: where contact details and paperless billing are changed today. */
const UPPCL_CONSUMER_URL = "https://consumer.uppcl.org/wss/";

export default function ProfileScreen() {
  const { t } = useI18n();
  const { data: me } = useMe();
  return (
    <Screen>
      <BackHeader title={t("your_details")} />
      <Profile loginPhone={me?.data?.[0]?.phone} />
    </Screen>
  );
}

/** Last 10 digits, so "+91 98…" and "98…" compare equal. */
const tenDigits = (p?: string | null) => (p ?? "").replace(/[^0-9]/g, "").slice(-10);

/**
 * What UPPCL has on record (official consumer details). Complaint status is looked up by mobile
 * number, so an outdated one here is why complaints can go missing — we say so plainly.
 */
function Profile({ loginPhone }: { loginPhone?: string }) {
  const c = useColors();
  const { t } = useI18n();
  const { data, error, isLoading, mutate } = useWssConsumer();
  const { data: dash } = useDashboard();
  const cd = data?.ConsumerDetails;
  if (!cd && isLoading) return <ActivityIndicator color={c.primary} style={{ paddingVertical: 32 }} />;
  if (!cd) {
    // The consumer portal is a separate UPPCL system and goes down on its own: show what UPPCL SMART
    // already told us instead of a blank page.
    const site = dash?.site;
    const addr = [site?.address, site?.pincode].filter(Boolean).join(", ");
    return (
      <>
        {error ? <ErrorNote error={error} compact /> : <Insight tone="warn" icon="warning" text={t("details_unavailable")} />}
        <Txt v="caption" color="muted">{t("details_from_smart")}</Txt>
        <Card style={{ padding: 0, gap: 0 }}>
          {!!site?.customerName && <Detail first label={t("name")} value={site.customerName} />}
          {!!tenDigits(loginPhone) && <Detail first={!site?.customerName} label={t("login_mobile")} value={tenDigits(loginPhone)} />}
          {!!addr && <Detail label={t("address")} value={addr} lines={3} />}
          <Pressable accessibilityRole="button" onPress={() => void mutate()}
            style={({ pressed }) => [styles.detail, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
            <Icon name="refresh" size={20} color={c.primary} />
            <Txt v="body" weight="semibold" color="primary" style={{ flex: 1 }}>{t("retry")}</Txt>
          </Pressable>
        </Card>
      </>
    );
  }
  const billPhone = tenDigits(cd.mobileNo), appPhone = tenDigits(loginPhone);
  const mismatch = !!billPhone && !!appPhone && billPhone !== appPhone;
  const mode = (cd.onlineBillingStatus || "").trim().toUpperCase();
  const billsBy = mode === "EMAIL" ? t("bills_by_email") : mode ? mode.charAt(0) + mode.slice(1).toLowerCase() : t("bills_by_paper");
  const address = (cd.billingAddress || "").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
  return (
    <>
      <Txt v="caption" color="muted">{t("registered_desc")}</Txt>
      {mismatch && <Insight tone="warn" icon="warning" text={t("phone_mismatch", { app: `••${appPhone.slice(-4)}`, bill: `••${billPhone.slice(-4)}` })} />}
      <Card style={{ padding: 0, gap: 0 }}>
        {!!cd.name && <Detail first label={t("name")} value={cd.name} />}
        {!!billPhone && <Detail first={!cd.name} label={t("registered_mobile")} value={billPhone} />}
        {!!cd.email && <Detail label={t("email")} value={cd.email} />}
        <Detail label={t("bills_by")} value={billsBy} />
        {!!address && <Detail label={t("billing_address")} value={address} lines={3} />}
        <View style={[styles.detail, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
          <Icon name="info" size={20} color={c.muted} />
          <Txt v="caption" color="muted" style={{ flex: 1 }}>{t("not_supported_yet")}</Txt>
        </View>
        <Pressable accessibilityRole="link" onPress={() => openLink(UPPCL_CONSUMER_URL)}
          style={({ pressed }) => [styles.detail, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }, pressed && { backgroundColor: c.bg }]}>
          <Icon name="person" size={20} color={c.primary} />
          <Txt v="body" weight="semibold" color="primary" style={{ flex: 1 }}>{t("change_on_official")}</Txt>
          <Icon name="chevronRight" size={20} color={c.muted} />
        </Pressable>
      </Card>
    </>
  );
}


/** A label/value row. */
function Detail({ label, value, first, lines = 1 }: { label: string; value: string; first?: boolean; lines?: number }) {
  const c = useColors();
  return (
    <View style={[styles.detail, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="caption" color="muted">{label}</Txt>
        <Txt v="body" weight="semibold" numeric numberOfLines={lines}>{value}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  detail: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
});
