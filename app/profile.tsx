/** "Your details": what UPPCL has on record for this connection. Bills by email can be switched here; the rest is read-only. */
import { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { setPaperlessBill, useDashboard, useMe, useWssConsumer } from "@shared/api";
import { ErrorNote } from "../src/errors";
import { useI18n } from "../src/i18n";
import { useColors } from "../src/theme";
import { BackHeader, Button, Card, Insight, Screen, Sheet, SkeletonRows, SlowNote, Txt } from "../src/ui";
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
/** UPPCL fills unknown fields with "NA"/"null"; show those as missing, never as a value. */
const known = (v?: string | null) => (v && !/^(na|n\/a|null|none|-)$/i.test(v.trim()) ? v : "");
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
  if (!cd && isLoading) return <><Card style={{ padding: 0, gap: 0 }}><SkeletonRows n={4} /></Card><SlowNote loading /></>;
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
          {!!known(site?.customerName) && <Detail first label={t("name")} value={site!.customerName} />}
          {!!tenDigits(loginPhone) && <Detail first={!known(site?.customerName)} label={t("login_mobile")} value={tenDigits(loginPhone)} />}
          {!!addr && <Detail label={t("address")} value={addr} lines={3} />}
          {/* Also in the UPPCL SMART record: no need to wait for the bill portal for these two. */}
          {!!known(String(site?.email ?? "")) && <Detail label={t("email")} value={String(site!.email)} />}
          {site && <PaperlessRow site={site} />}
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
      {mismatch && <Insight tone="warn" icon="warning" text={t("phone_mismatch", { app: `••${appPhone.slice(-4)}`, bill: `••${billPhone.slice(-4)}` })} />}
      <Card style={{ padding: 0, gap: 0 }}>
        {!!known(cd.name) && <Detail first label={t("name")} value={cd.name!} />}
        {!!billPhone && <Detail first={!known(cd.name)} label={t("registered_mobile")} value={billPhone} />}
        {!!cd.email && <Detail label={t("email")} value={cd.email} />}
        {dash?.site ? <PaperlessRow site={dash.site} portalMode={billsBy} portalEmail={cd.email ?? undefined} /> : <Detail label={t("bills_by")} value={billsBy} />}
        {!!address && <Detail label={t("billing_address")} value={address} lines={3} />}
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


/**
 * Bills by email: reads and writes UPPCL SMART's own flag (site/update), so the switch shows what it changed. The bill
 * portal keeps its own copy and can lag a bill cycle: shown as a note when the two differ. On needs an email on file
 * and a yes; off is harmless, so it's immediate with an Undo.
 */
function PaperlessRow({ site, portalMode, portalEmail }: { site: { email?: unknown; isPaperlessBillEnabled?: boolean }; portalMode?: string; portalEmail?: string }) {
  const c = useColors();
  const { t } = useI18n();
  // UPPCL fills a missing email with its own placeholder (…@uppclonline.com): e-bills sent there reach nobody.
  const raw = known(String(site.email ?? ""));
  const placeholder = /@uppclonline\.com$/i.test(raw);
  const email = placeholder ? "" : raw;
  const [on, setOn] = useState(!!site.isPaperlessBillEnabled);
  const [sheet, setSheet] = useState<"confirm" | "noEmail" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [undo, setUndo] = useState(false);
  const masked = email.replace(/^(.)[^@]*(@.*)$/, "$1••••$2");
  async function apply(v: boolean) {
    setBusy(true); setError(null);
    try { await setPaperlessBill(v); setOn(v); setSheet(null); setUndo(!v); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  const portalDiffers = !!portalMode && (portalMode === t("bills_by_email")) !== on;
  return (
    <View style={[styles.detail, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, flexDirection: "column", alignItems: "stretch", gap: 6 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="caption" color="muted">{t("bills_by")}</Txt>
          <Txt v="body" weight="semibold">{on ? t("pl_by_email", { email: (placeholder ? raw : masked).replace(/^(.)[^@]*(@.*)$/, "$1••••$2") || t("bills_by_email") }) : t("bills_by_paper")}</Txt>
        </View>
        <Switch value={on} disabled={busy} accessibilityLabel={t("pl_row")} trackColor={{ true: c.primary, false: c.track }} thumbColor={on ? c.onPrimary : c.muted}
          onValueChange={(v) => (v ? setSheet(email ? "confirm" : "noEmail") : void apply(false))} />
      </View>
      {portalDiffers && <Txt v="caption" color="muted">{t("pl_portal_differs", { mode: portalMode })}</Txt>}
      {on && placeholder && (
        // The "Change them on UPPCL's official site" link is the card's last row, just below: one door, not two (UX-R09).
        <Insight tone="warn" icon="warning" text={portalEmail ? t("pl_placeholder", { own: portalEmail.replace(/^(.)[^@]*(@.*)$/, "$1••••$2") }) : t("pl_placeholder_none")} />
      )}
      {undo && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Txt v="caption" color="muted" style={{ flex: 1 }}>{t("pl_off_done")}</Txt>
          <Pressable accessibilityRole="button" onPress={() => void apply(true)} hitSlop={12} style={{ minHeight: 48, justifyContent: "center" }}>
            <Txt v="label" color="primary" weight="semibold">{t("undo")}</Txt>
          </Pressable>
        </View>
      )}
      {!!error && <ErrorNote error={error} compact />}
      <Sheet visible={sheet === "confirm"} title={t("pl_on_title")} onClose={() => setSheet(null)}>
        <Txt v="body">{t("pl_on_body", { email: masked })}</Txt>
        {!!error && <ErrorNote error={error} compact />}
        <Button label={t("pl_yes")} busy={busy} onPress={() => void apply(true)} />
        <Button kind="soft" label={t("pl_keep")} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={sheet === "noEmail"} title={t("pl_no_email")} onClose={() => setSheet(null)}>
        <Txt v="body">{t("pl_no_email_body")}</Txt>
        <Button kind="soft" icon="openInNew" label={t("change_on_official")} onPress={() => openLink(UPPCL_CONSUMER_URL)} />
      </Sheet>
    </View>
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
