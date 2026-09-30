import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  downloadArrearsPdf, downloadBillPdf, downloadReceiptPdf,
  useBillHistory, useDashboard, useInvoices, usePayments, useWssArrears,
  type BillInvoice,
} from "@shared/api";
import { toNum } from "@shared/stats";
import { billingPeriod, rupees } from "@shared/utils";
import { ErrorNote } from "../../src/errors";
import { useI18n } from "../../src/i18n";
import { font, useColors } from "../../src/theme";
import { Bars } from "../../src/Bars";
import { Card, Insight, Pill, Screen, Txt } from "../../src/ui";
import { Icon } from "../../src/icons";

export default function Bills() {
  const c = useColors();
  const { t, locale } = useI18n();
  const { data: dash } = useDashboard();
  const postpaid = dash?.site.connectionType === "postpaid";
  // Postpaid gets monthly invoices with official PDFs; prepaid gets its statement history (no PDFs upstream).
  const invoices = useInvoices(24, dash !== undefined && postpaid);
  const history = useBillHistory(24, dash !== undefined && !postpaid);
  const payments = usePayments(20);
  const arrears = useWssArrears();
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<unknown>(null);
  const [allBills, setAllBills] = useState(false);
  const [allPayments, setAllPayments] = useState(false);

  const statements: BillInvoice[] = ((postpaid ? invoices.data?.data : history.data?.data) ?? [])
    .filter((b) => b.invoice_id)
    .sort((a, b) => String(b.bill_dt).localeCompare(String(a.bill_dt)))
    .slice(0, 12);

  async function pdf(id: string, run: () => Promise<void>) {
    setBusy(id);
    setPdfError(null);
    try { await run(); } catch (e) { setPdfError(e); } finally { setBusy(null); }
  }

  const refresh = () => { void invoices.mutate(); void history.mutate(); void payments.mutate(); void arrears.mutate(); };
  const refreshing = invoices.isValidating || history.isValidating || payments.isValidating;
  const arrearsAmt = toNum(arrears.data?.data?.amount);
  const month = (d: string) => billingPeriod(d).from.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const day = (d: string) => new Date(d).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const payList = payments.data?.data ?? [];
  // Summary: what the year cost, and a bar per bill so a jump stands out before reading any row.
  const yearAgo = Date.now() - 365 * 86400_000;
  const paidYear = payList.filter((p) => new Date(p.payment_dt).getTime() >= yearAgo).reduce((a, p) => a + toNum(p.amt), 0);
  const chrono = [...statements].reverse();
  // Credit months (negative bills) are drawn at their size in green, so they don't read as "no bill".
  const amounts = chrono.map((b) => Math.abs(toNum(b.bill_amt)));
  const credits = chrono.flatMap((b, i) => (toNum(b.bill_amt) < 0 ? [i] : []));
  const billed = chrono.map((b) => toNum(b.bill_amt)).filter((a) => a > 0);
  const avgBill = billed.length ? billed.reduce((a, b) => a + b, 0) / billed.length : 0;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Txt v="title">{postpaid ? t("bills_title_post") : t("bills_title")}</Txt>
      {!!(invoices.error || history.error || payments.error) && <ErrorNote error={invoices.error || history.error || payments.error} stale compact />}
      {busy && <Txt v="label" color="muted">{t("opening_pdf")}</Txt>}
      {/* Upstream's raw message ("not available for this connection") blames the account when the portal is just down. */}
      {!!pdfError && <ErrorNote error={pdfError} compact />}

      {(paidYear > 0 || amounts.length > 1) && (
        <Card>
          <View style={styles.sumRow}>
            <View style={{ flex: 1 }}>
              <Txt v="caption" color="muted">{postpaid ? t("paid_12m") : t("recharged_12m")}</Txt>
              <Txt v="value" numeric>₹{rupees(paidYear, { decimals: 0 })}</Txt>
            </View>
            {postpaid && avgBill > 0 && (
              <View style={{ alignItems: "flex-end" }}>
                <Txt v="caption" color="muted">{t("avg_bill")}</Txt>
                <Txt v="value" numeric>₹{rupees(avgBill, { decimals: 0 })}</Txt>
              </View>
            )}
          </View>
          {postpaid && amounts.length > 1 && (
            <Bars
              values={amounts}
              good={credits}
              labels={chrono.map((b) => billingPeriod(b.bill_dt).from.toLocaleDateString(locale, { month: "short" }))}
              details={chrono.map((b, i) => `${month(b.bill_dt)} · ${credits.includes(i) ? t("credit", { amount: rupees(amounts[i], { decimals: 0 }) }) : `₹${rupees(amounts[i], { decimals: 0 })}`}`)}
              summary={chrono.map((b, i) => `${month(b.bill_dt)} ₹${rupees(amounts[i], { decimals: 0 })}`).join(", ")}
              height={96}
              average={false}
            />
          )}
          {postpaid && credits.length > 0 && (
            <View style={styles.key}>
              <View style={[styles.swatch, { backgroundColor: c.ok }]} />
              <Txt v="caption" color="muted">{t("credit_key")}</Txt>
            </View>
          )}
          {postpaid && arrears.data && (
            <View style={styles.chips}>
              {arrearsAmt > 0
                ? <Pill tone="critical" label={t("arrears_chip", { amount: rupees(arrearsAmt, { decimals: 0 }) })} />
                : <Pill tone="ok" label={t("no_arrears")} />}
            </View>
          )}
        </Card>
      )}

      <Section title={t("statements")}>
        {statements.length === 0 ? (
          <Txt v="label" color="muted" style={styles.empty}>{t("none_statements")}</Txt>
        ) : statements.slice(0, allBills ? 12 : 6).map((inv, i) => {
          const amt = toNum(inv.bill_amt);
          const credit = amt < 0; // negative bill = UPPCL owes you, carried forward
          const paid = Boolean((inv.payment_dt || "").trim());
          return (
            <Row key={inv.invoice_id} first={i === 0}
              title={month(inv.bill_dt)}
              // Prepaid statements are charged from the balance: there is nothing to pay, so no pay status.
              sub={credit ? t("credit_note") : !postpaid ? t("from_balance") : paid && inv.payment_dt ? `${t("paid")} · ${day(inv.payment_dt)}` : t("unpaid")}
              status={credit || !postpaid ? undefined : paid ? "ok" : "warn"}
              amount={credit ? t("credit", { amount: rupees(Math.abs(amt), { decimals: 0 }) }) : `₹${rupees(amt, { decimals: 0 })}`}
              amountColor={credit ? "ok" : undefined}
              right={postpaid
                ? <PdfLink label={t("pdf")} busy={busy === inv.invoice_id} onPress={() => pdf(inv.invoice_id, () => downloadBillPdf(inv))} />
                : undefined}
            />
          );
        })}
        {!allBills && statements.length > 6 && <More label={t("show_all", { n: statements.length })} onPress={() => setAllBills(true)} />}
      </Section>

      <Section title={postpaid ? t("payments") : t("recharges")}>
        {(payments.data?.data ?? []).length === 0 ? (
          <Txt v="label" color="muted" style={styles.empty}>{t("none_recharges")}</Txt>
        ) : payList.slice(0, allPayments ? 10 : 3).map((p, i) => (
          <Row key={p._id ?? p.txn_id} first={i === 0}
            title={day(p.payment_dt)}
            sub={p.channel || p.payment_type || undefined}
            amount={`₹${rupees(p.amt, { decimals: 0 })}`}
            // UPPCL only offers the latest receipt, so it sits on the latest payment's row.
            right={postpaid && i === 0
              ? <PdfLink label={t("receipt_pdf")} busy={busy === "receipt"} onPress={() => pdf("receipt", downloadReceiptPdf)} />
              : <Pill label={postpaid ? t("received") : t("credited")} />}
          />
        ))}
        {!allPayments && payList.length > 3 && <More label={t("show_all", { n: Math.min(10, payList.length) })} onPress={() => setAllPayments(true)} />}
      </Section>

      {postpaid && arrearsAmt > 0 && (
        <Section title={t("arrears")}>
          <Row first
            title={arrearsAmt > 0 ? `₹${rupees(arrearsAmt, { decimals: 0 })}` : t("no_arrears")}
            right={arrearsAmt > 0
              ? <PdfLink label={t("arrears_statement")} busy={busy === "arrears"} onPress={() => pdf("arrears", downloadArrearsPdf)} />
              : <Pill label={t("clear")} />}
          />
        </Section>
      )}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      <Txt v="heading">{title}</Txt>
      <Card style={{ padding: 0, gap: 0 }}>{children}</Card>
    </View>
  );
}

function Row({ title, sub, status, amount, amountColor, right, first }: { title: string; sub?: string; status?: "ok" | "warn"; amount?: string; amountColor?: "ok"; right?: ReactNode; first: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="body" weight="semibold" numberOfLines={1}>{title}</Txt>
        {sub && (
          <View style={styles.sub}>
            {status && <Icon name={status === "ok" ? "checkCircle" : "warning"} size={14} color={c[status]} />}
            <Txt v="caption" color={status === "warn" ? "warn" : "muted"} numberOfLines={1} style={{ flexShrink: 1 }}>{sub}</Txt>
          </View>
        )}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {amount && <Txt v="body" numeric weight="bold" color={amountColor}>{amount}</Txt>}
        {right}
      </View>
    </View>
  );
}

function More({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.more, { borderTopColor: c.line }]}>
      <Txt v="label" color="primary" weight="semibold">{label}</Txt>
    </Pressable>
  );
}

function PdfLink({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} hitSlop={10} style={[styles.pdf, { opacity: busy ? 0.5 : 1 }]}>
      <Icon name="download" size={16} color={c.primary} />
      <Txt v="label" color="primary" weight="bold">{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sub: { flexDirection: "row", alignItems: "center", gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13, minHeight: 56 },
  empty: { padding: 16 },
  pdf: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingLeft: 8 },
  sumRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  more: { minHeight: 48, alignItems: "center", justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth },
});
