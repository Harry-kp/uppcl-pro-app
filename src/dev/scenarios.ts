/**
 * Dev-only test scenarios: fake accounts that answer every fetcher key, so prepaid, bill-due,
 * overdue and payment-result screens can be seen without a real account in that state.
 * Installed from boot.ts only when __DEV__; release builds never read this file's data.
 * All data is invented and dated relative to today.
 */
import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { ProxyError } from "@shared/api";
import { TEST_PDF } from "./testPdf";

export type ScenarioId = "prepaid_ok" | "prepaid_low" | "post_due" | "post_overdue" | "post_clear" | "portal_down" | "offline";
export type PayOutcome = "success" | "failed" | "pending";

export const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "prepaid_ok", label: "Prepaid · 8 days left" },
  { id: "prepaid_low", label: "Prepaid · 2 days left + planned cut" },
  { id: "post_due", label: "Postpaid · bill due in 6 days" },
  { id: "post_overdue", label: "Postpaid · bill overdue" },
  { id: "post_clear", label: "Postpaid · nothing due" },
  { id: "portal_down", label: "Bill portal + 1912 down (UPPCL errors)" },
  { id: "offline", label: "No internet" },
];

const KEY = "dev_scenario";
let active: ScenarioId | null = (SecureStore.getItem(KEY) as ScenarioId | null) ?? null;
const listeners = new Set<() => void>();
export const activeScenario = () => active;
export function setScenario(id: ScenarioId | null) {
  active = id;
  if (id) SecureStore.setItem(KEY, id); else void SecureStore.deleteItemAsync(KEY);
  listeners.forEach((l) => l());
}
/** Re-render when the scenario changes (the TEST DATA banner). */
export function useScenario(): ScenarioId | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, activeScenario);
}

// ── date helpers ────────────────────────────────────────────────────────────
const DAY = 86400_000;
const now = () => Date.now();
const iso = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T00:00:00`; };
const p2 = (n: number) => String(n).padStart(2, "0");
const dmy = (t: number) => { const d = new Date(t); return `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()}`; };
const env = <T>(data: T) => ({ code: 200, message: "OK", data });

// Daily kWh: calm around 6–8 with one clear spike, deterministic.
const kwhOn = (i: number) => (i === 9 ? 12.4 : 6.2 + ((i * 37) % 21) / 10);

function consumption(days: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, k) => {
    const i = days - 1 - k; // days ago, oldest first
    const t = today.getTime() - (i + 1) * DAY; // readings lag a day
    const v = kwhOn(i);
    return { energyImportKWH: { unit: "kWh", value: v, measureTime: iso(t) }, energyImportKVAH: { unit: "kVAh", value: v * 1.02, measureTime: iso(t) },
      energyExportKWH: { unit: "kWh", value: 0, measureTime: iso(t) }, power: { unit: "kW", value: 1.8, measureTime: iso(t) } };
  });
}

function monthly(year: number) {
  const out = [];
  const lastMonth = year === new Date().getFullYear() ? new Date().getMonth() : 11;
  for (let m = 0; m <= lastMonth; m++) {
    const v = 180 + ((m * 53) % 90);
    const at = `${year}-${p2(m + 1)}-01T00:00:00`;
    out.push({ energyImportKWH: { unit: "kWh", value: v, measureTime: at }, energyImportKVAH: { unit: "kVAh", value: v * 1.03, measureTime: at },
      energyExportKWH: { unit: "kWh", value: 0, measureTime: at }, power: { unit: "kW", value: 2.1, measureTime: at },
      powerFactor: { unit: "", value: 0.97, measureTime: at } });
  }
  return out;
}

// ── scenario data ───────────────────────────────────────────────────────────
function data(id: Exclude<ScenarioId, "portal_down" | "offline">) {
  const prepaid = id.startsWith("prepaid");
  const t = now();
  const site = {
    _id: "test-site", connectionId: "9000012345", deviceId: "TESTMETER01", tenantId: "pvvnl", tenantCode: "test", discom: "test",
    userId: "test-user", name: "9000012345", customerName: "Asha Verma", address: "House 12, Test Nagar, Meerut", pincode: "250001",
    sanctionedLoad: "3", connectionType: prepaid ? "prepaid" : "postpaid", meterInstallationNumber: "TESTMETER01", meterPhase: "1", meterType: "smart",
  };
  const daily30 = consumption(30);
  const balance = id === "prepaid_low" ? 130 : 540;
  const perDay = 61;
  const dailyBills = daily30.map((r, i) => {
    const units = Number(r.energyImportKWH.value);
    const close = balance + perDay * (29 - i);
    return { _id: `db${i}`, connectionId: site.connectionId, billDate: r.energyImportKWH.measureTime, dailyBill: {
      consumer_id: site.connectionId, meter_no: site.deviceId, usage_date: r.energyImportKWH.measureTime, units_billed_daily: String(units),
      day_end_reading: String(2000 + i * 7), opening_bal: String(close + perDay), closing_bal: String(close), daily_chg: String(units * 7.1),
      daily_en_chg: String(units * 6.4), daily_fc_chg: "4", daily_gvt_subsidy: "0", daily_ed_chg: "2", daily_rebate_chg: "0", cum_gvt_subsidy: "0" } };
  });
  const payments = (prepaid
    ? [[8, 1000, "UPI"], [24, 1000, "UPI"], [40, 500, "BBPS"]]
    : [[34, 1812, "Web"], [65, 2034, "UPI"], [96, 1960, "Web"]]
  ).map(([ago, amt, ch], i) => ({ _id: `pay${i}`, consumer_id: site.connectionId, installation_no: site.deviceId, status: "SUCCESS",
    payment_dt: iso(t - Number(ago) * DAY), txn_id: `TXN${i}`, amt: String(amt), payment_type: "ONLINE", channel: String(ch), msi: "", tenantCode: "test", tenantId: "pvvnl" }));

  // Postpaid invoices: the latest one is this month's bill (covers last month).
  const thisBillDt = new Date(new Date().getFullYear(), new Date().getMonth(), 2).getTime();
  const dueDt = id === "post_overdue" ? t - 3 * DAY : t + 6 * DAY;
  const latestPaid = id === "post_clear";
  const invoices = [0, 1, 2, 3, 4, 5].map((k) => {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() - k, 2).getTime();
    const amt = k === 0 ? 1922 : k === 3 ? -412 : 1600 + k * 110;
    const paid = k > 0 || latestPaid;
    return { invoice_id: `INV${k}`, bill_from_dt: iso(d - 30 * DAY), bill_amt: String(amt), due_dt: iso(k === 0 ? dueDt : d + 14 * DAY),
      bill_dt: iso(d), payment_dt: paid && amt > 0 ? iso(d + 9 * DAY) : "", payment_amt: paid && amt > 0 ? String(amt) : "" };
  });
  const outstanding = prepaid || latestPaid ? "0" : "1922";

  const complaints = [
    { data_id: "c1", complaint_no: "PV2609281234", status: "OPEN", is_open: true, entry_date: `${dmy(t - 1 * DAY).replace(/-/g, "/")} 07:42:00 PM`,
      closing_date: null, consumer_name: "Asha Verma", mobile_no: "9000000001", address: site.address, customer_account: site.connectionId,
      remarks: "Feeder tripped at the substation. Line crew assigned.", closing_remarks: null, closed_by: null, type: "Supply", sub_type: "No supply",
      source: "SMS", je_name: "R. K. Verma", je_mobile: "9000000011", ae_name: "S. Mishra", ae_mobile: "9000000012", xen_name: "A. Yadav", xen_mobile: "9000000013" },
    { data_id: "c2", complaint_no: "PV2608140917", status: "CLOSED", is_open: false, entry_date: `${dmy(t - 47 * DAY).replace(/-/g, "/")} 10:05:00 AM`,
      closing_date: `${dmy(t - 46 * DAY).replace(/-/g, "/")} 02:30:00 PM`, consumer_name: "Asha Verma", mobile_no: "9000000001", address: site.address,
      customer_account: site.connectionId, remarks: "Low voltage in the evening.", closing_remarks: "Transformer tap changed; voltage normal.", closed_by: "JE",
      type: "Supply", sub_type: "Low voltage", source: "1912", je_name: "R. K. Verma", je_mobile: "9000000011", ae_name: null, ae_mobile: null, xen_name: null, xen_mobile: null },
  ];

  return {
    site, prepaid, daily30, dailyBills, payments, invoices, outstanding, complaints,
    dashboard: {
      site,
      balance: { inr: prepaid ? balance : 0, updated_at: new Date(t - 6 * 60_000).toISOString(), meter_status: "ACTIVE", arrears_inr: 0, last_recharge: 1000 },
      runway: { days: prepaid ? balance / perDay : null, avg_daily_spend: prepaid ? perDay : 0, basis_days: 30 },
      consumption_30d: { kwh: daily30.reduce((a, r) => a + Number(r.energyImportKWH.value), 0), avg_daily_kwh: 6.9, effective_rate: 7.1, daily: daily30 },
      subsidy_ytd_inr: 0,
      recharge_lifespans: prepaid ? [{ amount: 1000, lasted_days: 16, txn: "TXN0" }] : [],
      recent_bills: prepaid ? dailyBills : [],
      recent_payments: payments,
    },
    payable: prepaid || latestPaid ? 0 : 1922,
    billDt: thisBillDt, dueDt,
  };
}

/** Answer a fetcher / bill-portal key for the active scenario; undefined = use the network. */
export function mockFor(key: string, pay: { outcome: PayOutcome }): unknown {
  if (!active || key === "/health") return undefined;
  if (key === "scenario:active") return true;
  if (key === "gateway:mock:billdesk") return FAKE_BILLDESK_HTML;
  // Failure scenarios throw exactly what the real network layer throws, so error screens can be checked.
  if (active === "offline") throw new ProxyError(0, "Network request failed", undefined, key.startsWith("wss:") ? "wss" : key.startsWith("/complaints") ? "complaints" : "uppcl", "network");
  if (active === "portal_down") {
    if (key.startsWith("wss:") || key.startsWith("/wss/")) throw new ProxyError(400, "Internal Server Error from get Discom", undefined, "wss");
    if (key.startsWith("/complaints")) throw new ProxyError(502, "fetch failed", { error: "fetch failed", upstream: "appsavy.com" }, "complaints");
  }
  const d = data(active === "portal_down" ? "post_due" : active);
  const [path, query = ""] = key.split("?");
  const q = new URLSearchParams(query);

  switch (path) {
    case "/dashboard": return d.dashboard;
    case "/balance/outstanding": return env({ consumerId: d.site.connectionId, outstandingAmount: d.outstanding, msi: "" });
    case "/bills/latest": return env(d.prepaid ? {} : d.invoices[0]);
    case "/bills/invoices": return env(d.invoices);
    case "/bills/history": return env(d.invoices.map((x) => ({ ...x, payment_dt: "", payment_amt: "" }))); // prepaid statements: charged from balance
    case "/bills": return env(d.dailyBills.slice(-Number(q.get("days") ?? 90)));
    case "/payments": return env(d.payments);
    case "/consumption": return env(consumption(Number(q.get("days") ?? 30)));
    case "/history/yearly": return env(monthly(Number(q.get("year") ?? new Date().getFullYear())));
    case "/me": return env([{ _id: "test-user", phone: "9000000001", phoneCountryCode: "+91", username: "9000000001", name: "Asha Verma" }]);
    case "/tenant-preferences": return env({ discomDetails: { whatsappNumber: "9000000099", email: "help@example.org", address: "Test discom office, Meerut 250001" } });
    case "/tickets": case "/alerts": case "/alarms": return env([]);
    case "/tips": return env([{ tipEnglish: "Set the fridge to 3–4 °C; colder only wastes power.", tipHindi: "फ़्रिज को 3–4 °C पर रखें; ज़्यादा ठंडा करने से बिजली बेकार जाती है।" }]);
    case "/downtime": return env(active === "prepaid_low" ? { title: "Planned cut", body: "Maintenance on the Test Nagar feeder, Sat 10 am – 1 pm." } : null);
    case "/wss/consumer": return { status: "SUCCESS", ConsumerDetails: { kno: d.site.connectionId, name: "Asha Verma", mobileNo: "9000000001", email: "asha@example.com",
      billingAddress: "House 12, Test Nagar, Meerut, 250001", onlineBillingStatus: "EMAIL", currentAddress: "" } };
    case "/wss/meter": return { status: "SUCCESS", data: { purposeOfSupply: "LMV1", meterStatus: "ACTIVE", previousReadingKWH: "2091", previousReadDateTime: "01-SEP-2026 00:00:00" } };
    case "/wss/arrears": return { status: "SUCCESS", data: { amount: "0", status: "N" } };
    case "/complaints": return { phone: q.get("phone"), complaints: d.complaints };
  }

  // Bill portal (payment flow and PDFs).
  const home = { kno: d.site.connectionId, payableAmt: String(d.payable), totalAmount: String(d.payable), discomName: "PVVNL",
    customerDetailsDTO: { billNo: "INV0", billDate: dmy(d.billDt), dueDate: dmy(d.dueDt), dueAmount: String(d.payable), purposeOfSupply: "LMV1", discomName: "PVVNL", mobileNo: "9000000001", email: "asha@example.com" } };
  if (key === "wss:v2/InstaPayment/GetPayBillDetails" || key === "wss:v2/InstaPayment/updateConsumerInputAmount") return { PayBillHomeDTO: home };
  if (key === "wss:v2/InstaPayment/processPaymentRequestWithPG") return { bdRequestDTO: { url: "mock:billdesk", message: "MOCK", trackId: "MOCK-TRACK" } };
  if (key.startsWith("wss:receipt:")) {
    const outcome = key.includes("success") ? "success" : key.includes("failed") ? "failed" : key.includes("pending") ? "pending" : pay.outcome;
    return { status: outcome, amount: String(d.payable || 1000), date: new Date().toISOString(), ref: "TEST-REF-0001", pdfBase64: outcome === "success" ? TEST_PDF : undefined };
  }
  if (key === "wss:v2/api/viewBillDownloadPDF") return { statusCode: "VIEW_BILL_PDF_200", Response: TEST_PDF };
  if (key === "wss:v2/lastOnlinePaymentReciept") return { bytecode: TEST_PDF };
  if (key.startsWith("wss:")) return {};
  return env([]); // anything else: empty, never the real account's data
}

/** The fake BillDesk page: three buttons that return to UPPCL's result URL like the real gateway. */
export const FAKE_BILLDESK_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:sans-serif;padding:24px;background:#f3f3f8;color:#1b1c2e}h1{font-size:20px}p{color:#585a73}
a{display:block;margin:12px 0;padding:14px;border-radius:12px;text-align:center;font-weight:700;text-decoration:none}
.ok{background:#2e7550;color:#fff}.fail{background:#b3261e;color:#fff}.wait{background:#e4e6f7;color:#3b47a8}</style></head><body>
<h1>TEST BillDesk page</h1><p>Test data: no money moves. Pick how this payment ends.</p>
<a class="ok" href="https://consumer.uppcl.org/wss/pgresponse?refNo=MOCK-success">Pay successfully</a>
<a class="fail" href="https://consumer.uppcl.org/wss/pgresponse?refNo=MOCK-failed">Payment fails</a>
<a class="wait" href="https://consumer.uppcl.org/wss/pgresponse?refNo=MOCK-pending">No answer from the bank</a>
</body></html>`;
