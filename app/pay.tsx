/**
 * Pay bill: a bottom sheet over Home (design: "UPPCL Pro Recharge" mockup, postpaid sheet) —
 * bill + due date, the amount due, one Pay button, "Pay a different amount" folded away.
 * Pay the electricity bill inside the app, using UPPCL's own payment flow (BillDesk):
 * bill details → amount → signed BillDesk form, posted in a WebView → UPPCL's result page
 * (pgresponse?refNo=…) → receipt. See docs/payment-reverse-engineering.md.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { mutate, useDashboard } from "@shared/api";
import {
  getPaymentReceipt, getPayBillDetails, onTimeSaving, payAmountError, startBillPayment,
  type PayBillHome, type PaymentReceipt, type PayType,
} from "@shared/payment";
import { platform } from "@shared/platform";
import { billingPeriod, parseUppclDate, rupees } from "@shared/utils";
import { UPPCL_SMART_URL } from "../src/boot";
import { ErrorNote } from "../src/errors";
import { useI18n } from "../src/i18n";
import { useColors } from "../src/theme";
import { Button, Insight, Segmented, Skeleton, SlowNote, Txt, familyFor, Field } from "../src/ui";
import { Icon } from "../src/icons";
import { openLink } from "../src/links";

type Gateway = { url: string; message: string; trackId: string };

export default function Pay() {
  const c = useColors();
  const { t, locale, lang } = useI18n();
  const { data: dash } = useDashboard();
  const [home, setHome] = useState<PayBillHome | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [type, setType] = useState<PayType>("1");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<unknown>(null);
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [checking, setChecking] = useState(false);
  const [custom, setCustom] = useState(false); // "Pay a different amount" opened
  const gatewayOpen = useRef(false); // BillDesk page showing; guards against handling its return twice

  useEffect(() => {
    getPayBillDetails()
      .then((h) => {
        setHome(h);
        const payable = Math.ceil(Number(h.payableAmt ?? 0));
        setType(payable > 0 ? "1" : "3");
        setAmount(payable > 0 ? String(payable) : "1000");
      })
      .catch((e) => setLoadError(e));
  }, []);

  const payable = Math.ceil(Number(home?.payableAmt ?? 0));
  const n = Number(amount);
  const rule = home && amount ? payAmountError(home, type, n) : null;
  const due = parseUppclDate(home?.customerDetailsDTO?.dueDate);

  async function pay() {
    if (!home || rule) return;
    setBusy(true);
    setPayError(null);
    try {
      const g = await startBillPayment(home, type, n);
      setTrackId(g.trackId);
      gatewayOpen.current = true;
      setGateway(g);
    } catch (e) {
      setPayError(e);
    } finally {
      setBusy(false);
    }
  }

  // UPPCL sends the browser back to its result page; that's our cue to close BillDesk and check.
  function onNav(nav: WebViewNavigation) {
    if (!/pgresponse/i.test(nav.url) || !gatewayOpen.current) return;
    gatewayOpen.current = false; // both WebView callbacks can report the same URL
    const ref = /refNo=([^&#]+)/i.exec(nav.url)?.[1];
    setGateway(null);
    void check(ref ? decodeURIComponent(ref) : trackId);
  }

  async function check(id: string | null) {
    if (!id) return;
    setChecking(true);
    setReceipt((r) => r ?? { status: "pending" });
    // BillDesk can take a few seconds to confirm; ask a few times before calling it pending.
    for (let i = 0; i < 4; i++) {
      const r = await getPaymentReceipt(id).catch(() => null);
      if (r) setReceipt(r);
      if (r && r.status !== "pending") break;
      if (i < 3) await new Promise((ok) => setTimeout(ok, 4000));
    }
    setChecking(false);
    void mutate((k) => typeof k === "string" && /^\/(dashboard|balance|payments|bills)/.test(k)); // refresh dues and history
  }

  if (receipt) return <Result receipt={receipt} checking={checking} onCheck={() => void check(trackId)} />;
  if (loadError) {
    return (
      <SheetFrame title={t("pay_title")}>
        <ErrorNote error={loadError} />
        <Button label={t("pay_on_smart")} kind="soft" onPress={() => openLink(UPPCL_SMART_URL)} />
      </SheetFrame>
    );
  }
  if (!home) return <SheetFrame title={t("pay_title")}><Skeleton w="45%" h={14} /><Skeleton w="55%" h={40} /><Skeleton h={52} r={14} /><SlowNote loading /></SheetFrame>;

  const ruleText = rule === "min_due" ? t("pay_rule_min", { amount: rupees(payable, { decimals: 0 }) })
    : rule === "part_range" ? t("pay_rule_part", { min: rupees(Math.ceil(payable * (home.customerDetailsDTO?.purposeOfSupply === "LMV1" ? 0.1 : 0.25)), { decimals: 0 }), max: rupees(payable, { decimals: 0 }) })
    : rule === "advance_1000" ? t("pay_rule_advance")
    : rule === "whole" ? t("pay_rule_whole") : null;

  // Real payments post UPPCL's signed form to BillDesk; dev test scenarios can serve a fake gateway page.
  let gatewayHtml = gateway ? autoPostForm(gateway) : "";
  if (gateway) gatewayHtml = (platform.mock?.(`gateway:${gateway.url}`) as string | undefined) ?? gatewayHtml; // data seam: sample data (src/demo.ts)
  const billDate = parseUppclDate(home.customerDetailsDTO?.billDate);
  const billMonth = billDate ? billingPeriod(billDate).from.toLocaleDateString(locale, { month: "long", year: "numeric" }) : null;
  const acctTail = dash ? String(dash.site.connectionId) : "";
  const editing = custom || payable === 0; // nothing due → advance payment needs an amount
  // Nothing due, and the last bill is from an earlier month: last month's bill simply isn't out yet. Say so,
  // or an advance payment reads like paying the bill (the same estimate Home shows).
  const onTime = payable > 0 ? onTimeSaving(home) : null;
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const awaiting = payable === 0 && billDate && billingPeriod(billDate).from < lastMonth
    ? lastMonth.toLocaleDateString(locale, { month: "long" }) : null;

  return (
    <SheetFrame title={t("pay_title")}>
      <View style={[styles.acct, { backgroundColor: c.bg }]}>
        <Icon name="receiptLong" size={18} color={c.primary} />
        <Txt v="label" style={{ flex: 1 }} numberOfLines={1}>
          {payable > 0 && billMonth ? t("pay_bill_of", { month: billMonth, id: acctTail }) : t("pay_account", { id: acctTail })}
        </Txt>
        {payable > 0 && due && <Txt v="caption" color="muted">{t("due_on", { date: due.toLocaleDateString(locale, { day: "numeric", month: "short" }) })}</Txt>}
      </View>

      <View style={{ alignItems: "center", gap: 2, paddingVertical: 4 }}>
        <Txt v="caption" color="muted">{payable > 0 ? t("amount_due") : t("nothing_due")}</Txt>
        {payable > 0 && <Txt v="hero" numeric color="big" style={{ fontSize: 44, lineHeight: 48 }}>₹{rupees(payable, { decimals: 0 })}</Txt>}
      </View>
      {!!awaiting && <Insight tone="accent" icon="event" text={t("pay_awaiting_bill", { month: awaiting })} />}
      {/* UPPCL's own on-time amount (bill portal). Message only: the amounts paid follow the portal's payableAmt. */}
      {!!onTime && <Insight tone="ok" icon="savings" text={t("pay_on_time", { date: onTime.by.toLocaleDateString(locale, { day: "numeric", month: "short" }), amount: rupees(onTime.amount, { decimals: 0 }), saving: rupees(onTime.saving, { decimals: 0 }) })} />}

      {editing && (
        <View style={{ gap: 8 }}>
          {payable > 0 ? (
            <Segmented<PayType> value={type} onChange={(v) => { setType(v); setAmount(String(payable)); }}
              options={[{ value: "1", label: t("pay_full") }, { value: "2", label: t("pay_part") }]} />
          ) : (
            <Txt v="caption" color="muted">{t("pay_advance_note")}</Txt>
          )}
          <View style={styles.amountRow}>
            <Txt v="title" color="muted">₹</Txt>
            <Field value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, "").slice(0, 7))} keyboardType="number-pad"
              accessibilityLabel={t("pay_amount")}
              warn={!!rule} style={[styles.input, { fontFamily: familyFor("bold", lang === "hi") }]} />
          </View>
          {ruleText && (
            <View style={styles.note}>
              <Icon name="warning" size={16} color={c.warn} />
              <Txt v="caption" color="warn" style={{ flex: 1 }}>{ruleText}</Txt>
            </View>
          )}
        </View>
      )}

      {!!payError && <ErrorNote error={payError} compact />}
      <Button label={t("pay_cta", { amount: rupees(n || 0, { decimals: 0 }) })} onPress={pay} busy={busy} disabled={!!rule || !n} />
      {!editing && (
        <Pressable accessibilityRole="button" onPress={() => setCustom(true)} style={styles.link}>
          <Txt v="label" color="primary" weight="semibold">{t("pay_different")}</Txt>
        </Pressable>
      )}
      <View style={[styles.note, { justifyContent: "center" }]}>
        <Icon name="lock" size={14} color={c.muted} />
        <Txt v="caption" color="muted" style={{ flexShrink: 1 }}>{t("pay_billdesk_note")}</Txt>
      </View>

      <Modal visible={!!gateway} animationType="slide" onRequestClose={() => setGateway(null)}>
        <View style={[styles.sheetHead, { backgroundColor: c.surface, borderBottomColor: c.line }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={() => setGateway(null)} hitSlop={10} style={styles.close}>
            <Icon name="arrowBack" size={22} color={c.text} />
          </Pressable>
          <Icon name="lock" size={16} color={c.ok} />
          <Txt v="label" weight="semibold" style={{ flex: 1 }}>{t("pay_secure_billdesk")}</Txt>
        </View>
        {gateway && (
          <WebView
            source={{ html: gatewayHtml }}
            originWhitelist={["https://*"]}
            // Catch UPPCL's result URL before it loads: we show our own result instead of their page.
            onShouldStartLoadWithRequest={(req) => { if (/pgresponse/i.test(req.url)) { onNav({ url: req.url } as WebViewNavigation); return false; } return true; }}
            onNavigationStateChange={onNav}
            startInLoadingState
            javaScriptEnabled
            setSupportMultipleWindows={false}
          />
        )}
      </Modal>
    </SheetFrame>
  );
}

/** The route renders as a transparent modal (see app/_layout.tsx): dimmed Home behind, sheet at the bottom. */
function SheetFrame({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
      <Pressable accessibilityLabel="Close" onPress={() => router.back()} style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,10,25,0.45)" }]} />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: 16 + insets.bottom }]}>
        <View style={[styles.grabber, { backgroundColor: c.line }]} />
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false} contentContainerStyle={{ gap: 12 }}>
          <Txt v="heading">{title}</Txt>
          {children}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/** The same one-field form the official site posts to BillDesk. */
function autoPostForm({ url, message }: Gateway): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html><body onload="document.forms[0].submit()"><form method="POST" action="${esc(url)}"><input type="hidden" name="msg" value="${esc(message)}"/></form></body></html>`;
}

function Result({ receipt, checking, onCheck }: { receipt: PaymentReceipt; checking: boolean; onCheck: () => void }) {
  const c = useColors();
  const { t } = useI18n();
  const tone = receipt.status === "success" ? "ok" : receipt.status === "failed" ? "critical" : "warn";
  return (
    <SheetFrame title={t("pay_title")}>
      <View style={{ alignItems: "center", gap: 10, paddingVertical: 12 }}>
        {checking ? <ActivityIndicator color={c.primary} /> : (
          <Icon name={receipt.status === "success" ? "checkCircle" : receipt.status === "pending" ? "schedule" : "warning"} size={48} color={c[tone]} />
        )}
        <Txt v="title" style={{ textAlign: "center" }}>
          {checking ? t("pay_checking") : receipt.status === "success" ? t("pay_done") : receipt.status === "failed" ? t("pay_failed") : t("pay_pending")}
        </Txt>
        {!!receipt.amount && <Txt v="value" numeric>₹{rupees(Number(receipt.amount), { decimals: 0 })}</Txt>}
        {!!receipt.ref && <Txt v="caption" color="muted">{t("pay_ref", { ref: receipt.ref })}</Txt>}
        <Txt v="caption" color="muted" style={{ textAlign: "center" }}>
          {receipt.status === "success" ? t("pay_done_desc") : receipt.status === "failed" ? t("pay_failed_desc") : t("pay_pending_desc")}
        </Txt>
      </View>
      {receipt.status === "success" && receipt.pdfBase64 && (
        <Button label={t("receipt_pdf")} kind="soft" onPress={() => platform.savePdf(receipt.pdfBase64!, `uppcl-receipt-${receipt.ref ?? "payment"}.pdf`)} />
      )}
      {receipt.status === "pending" && !checking && <Button label={t("pay_check_again")} kind="soft" onPress={onCheck} />}
      <Button label={t("done")} kind={receipt.status === "success" ? "primary" : "soft"} onPress={() => router.back()} />
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingTop: 8, maxHeight: "92%" },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  acct: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, borderWidth: 1.5, fontSize: 24, minHeight: 56 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 48, paddingBottom: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
