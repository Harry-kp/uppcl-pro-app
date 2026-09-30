// Basic sanity for the pure logic. Run: bun test
import { describe, expect, mock, test } from "bun:test";

// expo-secure-store is a native module; the dev scenarios read it at import time.
const store = new Map<string, string>();
mock.module("expo-secure-store", () => ({
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}));

import { ProxyError, type DashboardResponse } from "@shared/api";
import { payAmountError, type PayBillHome } from "@shared/payment";
import { newVaultKey, openJson, sealJson, wssDecrypt, wssEncrypt } from "@shared/crypto";
import { derivePostpaid, derivePrepaid } from "@shared/insights";
import { billingPeriod, kwh, parseUppclDate, rupees } from "@shared/utils";
const { mockFor, SCENARIOS, setScenario } = await import("../src/dev/scenarios");

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`;
const row = (t: string, v: number) => ({ energyImportKWH: { unit: "kWh", value: v, measureTime: t } });

function dash(p: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    site: { connectionId: "9000012345", sanctionedLoad: "3" },
    balance: { inr: 540, updated_at: null, meter_status: "ACTIVE", arrears_inr: 0, last_recharge: 1000 },
    runway: { days: 540 / 61, avg_daily_spend: 61, basis_days: 30 },
    consumption_30d: { kwh: 0, avg_daily_kwh: 6, effective_rate: null, daily: [] },
    subsidy_ytd_inr: 0, recharge_lifespans: [], recent_bills: [], recent_payments: [],
    ...p,
  } as DashboardResponse;
}

describe("utils", () => {
  test("parseUppclDate formats", () => {
    expect(parseUppclDate("30/09/2026 10:15:00 PM")).toEqual(new Date(2026, 8, 30, 22, 15, 0));
    expect(parseUppclDate("01/10/2026 12:05:00 AM")).toEqual(new Date(2026, 9, 1, 0, 5, 0));
    expect(parseUppclDate("05-SEP-2026 10:30:00")).toEqual(new Date(2026, 8, 5, 10, 30, 0));
    expect(parseUppclDate("05-09-2026")).toEqual(new Date(2026, 8, 5));
    expect(parseUppclDate("2026-09-05T00:00:00")?.getDate()).toBe(5);
    expect(parseUppclDate("not a date")).toBeNull();
    expect(parseUppclDate(null)).toBeNull();
  });

  test("rupees / kwh formatting", () => {
    expect(rupees(1234.5)).toBe("1,234.50");
    expect(rupees(100000, { decimals: 0 })).toBe("1,00,000");
    expect(rupees(5, { sign: true })).toBe("+5.00");
    expect(rupees(null)).toBe("—");
    expect(rupees("abc")).toBe("—");
    expect(kwh("3.456")).toBe("3.46");
    expect(kwh(undefined)).toBe("—");
  });

  test("billingPeriod covers the month before the bill date", () => {
    const p = billingPeriod(new Date(2026, 5, 3));
    expect(p.from).toEqual(new Date(2026, 4, 1));
    expect(p.to).toEqual(new Date(2026, 5, 1));
    expect(p.label).toBe("May 2026");
  });
});

describe("insights", () => {
  test("derivePrepaid: recharge advice and empty ETA", () => {
    const now = at(2026, 9, 20);
    const bills = [3, 2, 1].map((ago, i) => ({
      billDate: new Date(now - ago * 86400_000).toISOString(),
      dailyBill: { units_billed_daily: String(6 + i), daily_chg: String(40 + i) },
    })) as DashboardResponse["recent_bills"];
    const r = derivePrepaid(dash({ recent_bills: bills }), undefined, undefined, undefined, now);
    expect(r.todayKwh).toBe(8);
    expect(r.yestKwh).toBe(7);
    // 40 days × ₹61 − ₹540 = ₹1,900 → rounded up to ₹2,000
    expect(r.recommendedAmount).toBe(2000);
    expect(r.emptyEta?.getTime()).toBe(new Date(now + (540 / 61) * 86400_000).getTime());
    expect(r.anomaly).toBe(false);
  });

  test("derivePostpaid: month rolled over, bill not out yet → pendingBill", () => {
    const yearly = [row(iso(2026, 8, 1), 180), row(iso(2026, 9, 1), 200)];
    const inv = { bill_dt: iso(2026, 9, 2), due_dt: iso(2026, 9, 16), bill_amt: "1260", payment_dt: iso(2026, 9, 10) };
    const r = derivePostpaid(dash(), { outstandingAmount: "0", inv, yearly } as never, at(2026, 10, 1));
    expect(r.effectiveRate).toBe(7); // ₹1,260 ÷ 180 kWh (August)
    expect(r.pendingBill?.month).toEqual(new Date(2026, 8, 1));
    expect(r.pendingBill?.kwh).toBe(200);
    expect(r.pendingBill?.amount).toBe(1400);
    expect(r.pendingBill?.vsLast).toBe(11);
    expect(r.billPaid).toBe(true);
  });

  test("derivePostpaid: no pendingBill once the bill is out, or while dues are open", () => {
    const yearly = [row(iso(2026, 9, 1), 200)];
    const out = { bill_dt: iso(2026, 10, 2), bill_amt: "1400", payment_dt: "" };
    expect(derivePostpaid(dash(), { outstandingAmount: "1400", inv: out, yearly } as never, at(2026, 10, 5)).pendingBill).toBeNull();
    const old = { bill_dt: iso(2026, 9, 2), bill_amt: "1260", payment_dt: "" };
    const r = derivePostpaid(dash(), { outstandingAmount: "1260", inv: old, yearly } as never, at(2026, 10, 1));
    expect(r.hasDues).toBe(true);
    expect(r.pendingBill).toBeNull();
  });
});

describe("payAmountError", () => {
  const due = { payableAmt: "1000", customerDetailsDTO: { purposeOfSupply: "LMV1" } } as PayBillHome;
  const clear = { payableAmt: "0" } as PayBillHome;
  test.each([
    [due, "1", 10.5, "whole"], [due, "1", 0, "whole"], [due, "1", 10_000_000, "whole"],
    [due, "1", 999, "min_due"], [due, "1", 1000, null], [due, "1", 1500, null],
    [due, "2", 99, "part_range"], [due, "2", 100, null], [due, "2", 1001, "part_range"],
    [{ payableAmt: "1000" } as PayBillHome, "2", 249, "part_range"],
    [due, "3", 1000, "advance_1000"], [clear, "3", 1500, "advance_1000"], [clear, "3", 2000, null],
  ] as const)("%#: type %s ₹%d → %s", (home, type, amount, want) => {
    expect(payAmountError(home, type, amount)).toBe(want);
  });
});

test("wss crypto round-trip", async () => {
  const plain = JSON.stringify({ kno: "9000012345", note: "बिल ₹" });
  const c = await wssEncrypt(plain);
  expect(c).toMatch(/^[0-9a-f]{96}/);
  expect(await wssDecrypt(c)).toBe(plain);
  expect(await wssEncrypt(plain)).not.toBe(c); // fresh salt + IV each time
});

describe("dev scenarios", () => {
  const pay = { outcome: "success" as const };
  test("no scenario → real network", () => {
    setScenario(null);
    expect(mockFor("/dashboard", pay)).toBeUndefined();
  });

  test.each(SCENARIOS.map((s) => s.id))("%s answers with the right shapes", (id) => {
    setScenario(id);
    if (id === "offline") {
      expect(() => mockFor("/dashboard", pay)).toThrow(ProxyError);
      return;
    }
    const d = mockFor("/dashboard", pay) as DashboardResponse;
    expect(d.site.connectionType).toBe(id.startsWith("prepaid") ? "prepaid" : "postpaid");
    expect(Array.isArray(d.consumption_30d.daily)).toBe(true);
    expect((mockFor("/bills/invoices", pay) as { data: unknown[] }).data).toHaveLength(6);
    expect((mockFor("/unknown", pay) as { data: unknown[] }).data).toEqual([]);
    if (id === "portal_down") {
      expect(() => mockFor("wss:v2/InstaPayment/GetPayBillDetails", pay)).toThrow(ProxyError);
      expect(() => mockFor("/complaints?phone=9000000001", pay)).toThrow(ProxyError);
      return;
    }
    expect((mockFor("/complaints?phone=9000000001", pay) as { complaints: unknown[] }).complaints.length).toBeGreaterThan(0);
    const home = (mockFor("wss:v2/InstaPayment/GetPayBillDetails", pay) as { PayBillHomeDTO: PayBillHome }).PayBillHomeDTO;
    expect(Number(home.payableAmt)).toBe(id === "post_due" || id === "post_overdue" ? 1922 : 0);
    expect((mockFor("wss:receipt:failed", pay) as { status: string }).status).toBe("failed");
  });
});

describe("vault (sealed on-device store)", () => {
  test("round-trips a JSON map", () => {
    const k = newVaultKey();
    const map = { uppcl_session: JSON.stringify({ jwt: "x".repeat(4000) }), app_lang: "hi" };
    expect(openJson(k, sealJson(k, map))).toEqual(map);
  });
  test("rejects a wrong key", () => {
    const sealed = sealJson(newVaultKey(), { a: "1" });
    expect(() => openJson(newVaultKey(), sealed)).toThrow();
  });
  test("rejects tampered data", () => {
    const k = newVaultKey();
    const sealed = sealJson(k, { a: "1" });
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("00") ? "11" : "00");
    expect(() => openJson(k, flipped)).toThrow();
  });
});
