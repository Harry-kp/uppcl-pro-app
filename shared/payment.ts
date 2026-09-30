/**
 * Bill payment through UPPCL's official /wss portal and BillDesk. The flow and field meanings are in
 * docs/payment-reverse-engineering.md; app/pay.tsx drives it.
 */
import { primarySite, ProxyError, send, wssDiscom, wssPost } from "./api";
import { wssDecrypt } from "./crypto";
import { platform } from "./platform";
import type { SiteRecord } from "./session";
import { parseUppclDate } from "./utils";

/** The discom names the pay-bill API accepts (differs from wssDiscom for two discoms). */
function payDiscom(site: SiteRecord): string {
  const d = wssDiscom(site);
  return d === "KESCO" ? "KESCo" : d === "PUVVNL" ? "PUVNL" : d;
}

/** Opaque DTO the portal expects back unchanged on every step; we read a few fields. */
export interface PayBillHome {
  kno?: string;
  payableAmt?: string | number;
  totalAmount?: string | number;
  paymentType?: string;
  partialPayment?: string | null;
  email?: string;
  mobile?: string;
  discomName?: string;
  serviceName?: string;
  empRefNo?: string | null;
  payBillDetailsDTO?: Record<string, unknown>;
  customerDetailsDTO?: {
    billNo?: string; billDate?: string; dueDate?: string; dueAmount?: string; email?: string;
    mobileNo?: string; discomName?: string; purposeOfSupply?: string; typeOfConnection?: string;
  };
  [k: string]: unknown;
}

/** 1 = pay the due amount, 2 = part payment, 3 = advance (only when nothing is due). */
export type PayType = "1" | "2" | "3";

export async function getPayBillDetails(): Promise<PayBillHome> {
  const site = await primarySite();
  const res = await wssPost<{ PayBillHomeDTO?: PayBillHome; ResMsg?: string; statusMsg?: string }>(
    "v2/InstaPayment/GetPayBillDetails", { kno: site.connectionId, discomName: payDiscom(site) });
  if (!res.PayBillHomeDTO) throw new ProxyError(404, res.ResMsg || res.statusMsg || "Bill details not available", undefined, "wss");
  return res.PayBillHomeDTO;
}

/**
 * The portal's own amount rules (client-side in the official app): whole rupees, > 0, < 1 crore;
 * due: at least the payable amount; part: at most payable and at least 10% (LMV1) / 25%;
 * advance: only when nothing is due, in multiples of ₹1,000. Returns an error key or null.
 */
export function payAmountError(home: PayBillHome, type: PayType, amount: number): "whole" | "min_due" | "part_range" | "advance_1000" | null {
  const payable = Number(home.payableAmt ?? 0);
  if (!Number.isInteger(amount) || amount <= 0 || amount >= 10_000_000) return "whole";
  if (type === "1" && amount < payable) return "min_due";
  if (type === "2") {
    const minPct = home.customerDetailsDTO?.purposeOfSupply === "LMV1" ? 0.1 : 0.25;
    if (amount > payable || amount < Math.ceil(payable * minPct)) return "part_range";
  }
  if (type === "3" && (payable > 0 || amount % 1000 !== 0)) return "advance_1000";
  return null;
}

/** Steps 2–4: set the amount, then ask the portal for the signed BillDesk message. Creates a pending payment. */
export async function startBillPayment(home: PayBillHome, type: PayType, amount: number):
  Promise<{ url: string; message: string; trackId: string }> {
  const site = await primarySite();
  const discomName = home.customerDetailsDTO?.discomName ?? payDiscom(site);
  const priced = await wssPost<{ PayBillHomeDTO?: PayBillHome }>("v2/InstaPayment/updateConsumerInputAmount", {
    ...home, paymentType: type, partialPayment: type === "2" ? "yes" : null, totalAmount: String(amount), discomName,
  });
  const h = priced.PayBillHomeDTO ?? home;
  const cd = h.customerDetailsDTO ?? {};
  const billDate = cd.billDate ? toIsoDate(cd.billDate) : null;
  const body = {
    ...h, paymentType: type, partialPayment: type === "2" ? "yes" : null, totalAmount: String(amount), discomName,
    email: cd.email ?? h.email, mobile: cd.mobileNo ?? h.mobile,
    payBillDetailsDTO: {
      paymentId: "WEB", bankId: "BILLDESK", billDate, billDueDate: cd.dueDate ?? "",
      caseOrBillNo: type === "3" ? "Advanced Payment" : cd.billNo, empRefNo: h.empRefNo ?? null,
      serviceName: null, matchTypeCode: null,
    },
  };
  const res = await wssPost<{ bdRequestDTO?: { message?: string; url?: string; trackId?: string }; statusMsg?: string }>(
    "v2/InstaPayment/processPaymentRequestWithPG", body);
  const bd = res.bdRequestDTO;
  if (!bd?.message || !bd.url || !bd.trackId) throw new ProxyError(502, res.statusMsg || "Could not start the payment", undefined, "wss");
  return { url: bd.url, message: bd.message, trackId: String(bd.trackId) };
}

/** "DD-MM-YYYY" / "DD-MMM-YYYY" / ISO → "YYYY-MM-DD" (what the portal's payment request wants). */
function toIsoDate(s: string): string | null {
  const d = parseUppclDate(s);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface PaymentReceipt {
  status: "success" | "pending" | "failed";
  amount?: string; date?: string; ref?: string; pdfBase64?: string;
}

/** Step 6: after BillDesk sends the user back. "1"/"4" = paid, "0" = no answer from BillDesk yet. */
export async function getPaymentReceipt(trackId: string): Promise<PaymentReceipt> {
  const mocked = platform.mock?.(`wss:receipt:${trackId}`); if (mocked !== undefined) return mocked as PaymentReceipt; // @dev-tools seam
  const r = await send("wss", `v2/InstaPayment/getPaymentReciept?trackID=${encodeURIComponent(trackId)}`, { cache: "no-store" });
  if (!r.ok) throw new ProxyError(r.status, "Bill portal unavailable", undefined, "wss");
  let json = (await r.json()) as Record<string, unknown>;
  if (typeof json._cdata === "string") json = JSON.parse(await wssDecrypt(json._cdata)) as Record<string, unknown>;
  const pr = (json.PaymentReciept ?? {}) as Record<string, unknown>;
  const code = String(pr.paymentStatus ?? "");
  return {
    status: code === "1" || code === "4" ? "success" : code === "0" || code === "" ? "pending" : "failed",
    amount: pr.payment_amount as string | undefined, date: pr.paymentDate as string | undefined,
    ref: (pr.tran_ref_number ?? pr.trackId) as string | undefined, pdfBase64: (json.bytecode as string | undefined) || undefined,
  };
}
