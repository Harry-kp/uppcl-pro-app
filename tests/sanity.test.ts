// Basic sanity for the pure logic. Run: bun test
import { describe, expect, mock, test } from "bun:test";

// expo-secure-store is a native module; the dev scenarios read it at import time.
const store = new Map<string, string>();
mock.module("expo-secure-store", () => ({
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}));

mock.module("react-native", () => ({ Linking: { openURL: async () => {} } }));
mock.module("expo-router", () => ({ router: { push: () => {} } }));

import { ProxyError, type DashboardResponse } from "@shared/api";
import { onTimeSaving, payAmountError, type PayBillHome } from "@shared/payment";
import { newVaultKey, openJson, sealJson, wssDecrypt, wssEncrypt } from "@shared/crypto";
import { billRebate, busiestHours, derivePostpaid, derivePrepaid, hourlyUnits, monthFromDaily } from "@shared/insights";
import { billingPeriod, kwh, parseUppclDate, rupees } from "@shared/utils";
const { mockFor, SCENARIOS, setScenario } = await import("../src/dev/scenarios");
const { isInAppUrl } = await import("../src/links");
const { cleanRemarks, complaintNoIn, mobile10, openFor, parseByChild, personName, pickDistrict, placeKey, sourceKind, supplySaveXml, withContact } = await import("@shared/complaints");

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

  test("derivePostpaid: no invoice (UPPCL bill history down) on 1 Oct → September's bill from daily readings", () => {
    // 29 of September's 30 days reported (daily lag), 7 units each; no monthly rollup for September yet.
    const daily = Array.from({ length: 29 }, (_, i) => row(iso(2026, 9, i + 1), 7));
    const r = derivePostpaid(dash({ consumption_30d: { kwh: 203, avg_daily_kwh: 7, effective_rate: null, daily } } as never),
      { outstandingAmount: "0", yearly: [row(iso(2026, 8, 1), 180)] } as never, at(2026, 10, 1));
    expect(r.rateFrom).toBe("typical");
    expect(r.effectiveRate).toBe(6.5);
    expect(r.pendingBill?.month).toEqual(new Date(2026, 8, 1));
    expect(r.pendingBill?.kwh).toBe(210); // 29 days × 7, scaled to 30 days
    expect(r.pendingBill?.amount).toBe(1365);
    // Late in the month with still no invoice: don't keep guessing last month's bill.
    expect(derivePostpaid(dash({ consumption_30d: { kwh: 203, avg_daily_kwh: 7, effective_rate: null, daily } } as never),
      { outstandingAmount: "0" } as never, at(2026, 10, 25)).pendingBill).toBeNull();
  });

  test("monthFromDaily: scales a lagging month, ignores other months", () => {
    const daily = [row(iso(2026, 8, 31), 99), ...Array.from({ length: 29 }, (_, i) => row(iso(2026, 9, i + 1), 7)), row(iso(2026, 10, 1), 99)];
    expect(monthFromDaily(daily, new Date(2026, 8, 1))).toBe(210);
    expect(monthFromDaily([], new Date(2026, 8, 1))).toBe(0);
  });

  test("derivePostpaid: peak load is the highest daily peak (kW) against the sanctioned load", () => {
    const daily = [1.2, 3.1, 2.4].map((kw, i) => ({ ...row(iso(2026, 9, i + 1), 7), power: { unit: "KW", value: kw, measureTime: iso(2026, 9, i + 1) } }));
    const r = derivePostpaid(dash({ site: { connectionId: "9000012345", sanctionedLoad: "4" }, consumption_30d: { kwh: 21, avg_daily_kwh: 7, effective_rate: null, daily } } as never), { outstandingAmount: "0" } as never, at(2026, 9, 20));
    expect(r.peakKw).toBe(3.1);
    expect(r.demandPct).toBe(78);
  });

  test("hour by hour: 15-min readings summed per local hour; the busiest 3-hour stretch", () => {
    const at15 = (h: number, q: number) => new Date(2026, 8, 29, h, q * 15).toISOString();
    const rows = [...Array(24).keys()].flatMap((h) => [0, 1, 2, 3].map((q) => row(at15(h, q), h >= 19 && h < 22 ? 0.5 : 0.05)));
    const hours = hourlyUnits(rows as never);
    expect(hours[20]).toBeCloseTo(2, 5);
    expect(hours[3]).toBeCloseTo(0.2, 5);
    expect(busiestHours(hours)).toEqual({ start: 19, share: Math.round((6 / (6 + 21 * 0.2)) * 100) });
    expect(busiestHours(Array(24).fill(0))).toBeNull();
  });

  test("derivePostpaid: rate source is named honestly", () => {
    const yearly = [row(iso(2026, 8, 1), 180)];
    const inv = { bill_dt: iso(2026, 9, 2), bill_amt: "1260", payment_dt: iso(2026, 9, 10) };
    expect(derivePostpaid(dash(), { outstandingAmount: "0", inv, yearly } as never, at(2026, 9, 20)).rateFrom).toBe("bill");
    const recent = dash({ consumption_30d: { kwh: 0, avg_daily_kwh: 6, effective_rate: 7.25, daily: [] } } as never);
    const r = derivePostpaid(recent, { outstandingAmount: "0" } as never, at(2026, 9, 20));
    expect(r.rateFrom).toBe("recent");
    expect(r.effectiveRate).toBe(7.25);
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
    // The live pay DTO says purposeOfSupply "10" (a code) and supplyType "LMV1": still domestic, 10%.
    [{ payableAmt: "1000", customerDetailsDTO: { purposeOfSupply: "10", supplyType: "LMV1" } } as PayBillHome, "2", 100, null],
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

describe("in-app web page (deep-linkable, so allowlisted)", () => {
  test("opens the app's own links", () => {
    expect(isInAppUrl("https://github.com/Harry-kp/uppcl-pro-app/issues/new?title=x")).toBe(true);
    expect(isInAppUrl("https://uppcl.sem.jio.com/uppclsmart/signup")).toBe(true);
  });
  test("refuses anything else", () => {
    for (const u of ["https://evil.example/login", "http://github.com/", "javascript:alert(1)", "https://github.com.evil.example/", "", undefined])
      expect(isInAppUrl(u)).toBe(false);
  });
});

describe("1912 complaint fields (as UPPCL sends them)", () => {
  test("officer phones: 00-padded → 10 digits; junk → null", () => {
    expect(mobile10("009000000022")).toBe("9000000022");
    expect(mobile10("9000000021")).toBe("9000000021");
    expect(mobile10("12345")).toBeNull();
    expect(mobile10(null)).toBeNull();
  });
  test("officer names: tidy, and not a line name", () => {
    expect(personName("SHRI RAM KUMAR (RAMPUR KHURD")).toBe("Ram Kumar (Rampur Khurd)");
    expect(personName("SHRI MOHAN LAL SINGH")).toBe("Mohan Lal Singh");
    expect(personName("11 KV LT 9000000021")).toBeNull();
    expect(personName("")).toBeNull();
  });
  test("how it was filed, and how long it took", () => {
    expect(sourceKind("1912")).toBe("call");
    expect(sourceKind("1912 Web")).toBe("web");
    expect(sourceKind("WhatsApp")).toBe("whatsapp");
    expect(sourceKind(null)).toBeNull();
    const closed = { entry_date: "19/05/2026 03:31:30 PM", closing_date: "19/05/2026 06:53:18 PM", is_open: false };
    expect(openFor(closed)).toBe((3 * 60 + 21) * 60_000 + 48_000);
    const open = { entry_date: "30/09/2026 10:00:00 PM", closing_date: null, is_open: true };
    expect(openFor(open, new Date(2026, 9, 1, 1, 0, 0).getTime())).toBe(3 * 3600_000);
  });
});

describe("session", () => {
  test("a session that runs out on its own is reported as expired, not silently dropped", async () => {
    const { configurePlatform } = await import("@shared/platform");
    const { getSession, saveSession, sessionWasExpired } = await import("@shared/session");
    const mem = new Map<string, string>();
    configurePlatform({ storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) } });
    saveSession({ jwt: "x", jwtExpiresMs: Date.now() + 60_000, tenant: "t" });
    expect(getSession()).not.toBeNull();
    expect(sessionWasExpired()).toBe(false);
    saveSession({ jwt: "x", jwtExpiresMs: Date.now() - 1, tenant: "t" });
    expect(getSession()).toBeNull();
    expect(sessionWasExpired()).toBe(true);
  });
});

describe("due-date rebate (bill portal's payAmtBeforeDueDt)", () => {
  const home = (cd: Record<string, string>) => ({ payableAmt: "1612", customerDetailsDTO: { dueDate: "18-SEP-2026", dueAmount: "1612.00", ...cd } }) as PayBillHome;
  test("before the due date: the on-time amount and the saving", () => {
    expect(onTimeSaving(home({ payAmtBeforeDueDt: "1597.00" }), new Date(2026, 8, 10))).toEqual({ by: new Date(2026, 8, 18), amount: 1597, saving: 15 });
    expect(onTimeSaving(home({ payAmtBeforeDueDt: "1597.00" }), new Date(2026, 8, 18, 20))?.saving).toBe(15); // the due day itself counts
  });
  test("nothing when it can't be right", () => {
    expect(onTimeSaving(home({ payAmtBeforeDueDt: "1597.00" }), new Date(2026, 8, 19))).toBeNull(); // too late
    expect(onTimeSaving(home({}), new Date(2026, 8, 10))).toBeNull(); // field missing
    expect(onTimeSaving(home({ payAmtBeforeDueDt: "1612.00" }), new Date(2026, 8, 10))).toBeNull(); // no saving
    expect(onTimeSaving(home({ payAmtBeforeDueDt: "1000" }), new Date(2026, 8, 10))).toBeNull(); // 38% off: not a rebate
  });
});

describe("billRebate", () => {
  const b = (o: object) => ({ bill_amt: "1612", payment_amt: "1597", payment_dt: "2026-09-11T00:00:00+05:30", due_dt: "2026-09-18T00:00:00+05:30", ...o });
  test("paid on time, a little less: that's the rebate", () => expect(billRebate(b({}))).toBe(15));
  test("paid on the due date itself counts", () => expect(billRebate(b({ payment_dt: "2026-09-18T00:00:00+05:30" }))).toBe(15));
  test("late, unpaid, credit, full or odd amounts: nothing", () => {
    expect(billRebate(b({ payment_dt: "2026-09-20T00:00:00+05:30" }))).toBeNull();
    expect(billRebate(b({ payment_amt: "", payment_dt: "" }))).toBeNull();
    expect(billRebate(b({ bill_amt: "-638" }))).toBeNull();
    expect(billRebate(b({ payment_amt: "1612" }))).toBeNull();
    expect(billRebate(b({ payment_amt: "1000" }))).toBeNull(); // part payment, not a rebate
  });
});

describe("1912 supply complaint (form 6444)", () => {
  // Made-up values only.
  const draft = {
    problem: "no_power" as const, outage: "Individual" as const, account: "1234567890", district: { id: "1001", name: "TESTPUR" },
    name: "Test User", mobile: "9000000000", substation: "Test SS", subdivision: "Test SD", substations: [], blocked: null,
    controls: { 59929: "1001", 59944: "9000000000", 59945: "1234567890", 59930: "CT019", 59931: "CST120", 95303: "Individual", 59942: "Test User", 59946: "A-1, Test Nagar & Co" } as Record<string, string>,
  };
  const xml = supplySaveXml(draft, `No supply since 9 pm, <b>"pole" | $ 'fuse'`, new Date(2026, 9, 1, 21, 5, 9));

  test("the page's FORM envelope, date and save event", () => {
    expect(xml.startsWith('<?xml version="1.0"?><FORM IUVLOGINID="anonymous" USERID="anonymous" ROLE_ID="883" ID="6444" COMPANY_ID="64" EventControlID="59950" SRC="W">')).toBe(true);
    expect(xml).toContain('<DATA DATE="01-Oct-2026 21:05:09"><UNIQUEID VALUE="');
    expect(xml.endsWith("</DATA></FORM>")).toBe(true);
    expect(xml).not.toContain('CONTROL ID="59950"'); // the Save button itself isn't data
  });
  test("every saved control is there once, with its value", () => {
    for (const id of ["59929", "59932", "59937", "59944", "59945", "59931", "59942", "59949", "60043", "96559", "130595"])
      expect(xml.split(`<CONTROL ID="${id}" `).length).toBe(2);
    expect(xml).toContain('<CONTROL ID="59931" VALUE="CST120" />');
    expect(xml).toContain('<CONTROL ID="141592" VALUE="OR" />'); // label default, as the page sends it
    expect(xml).toContain('<CONTROL ID="59946" VALUE="A-1, Test Nagar &amp; Co" />'); // XML-escaped
  });
  test("remarks lose the characters 1912 refuses; Hindi is kept as entities", () => {
    expect(cleanRemarks(`No supply since 9 pm, <b>"pole" | $ 'fuse'`)).toBe("No supply since 9 pm b pole fuse");
    expect(xml).toContain('<CONTROL ID="59949" VALUE="No supply since 9 pm b pole fuse" />');
    expect(supplySaveXml(draft, "बिजली नहीं")).toContain('VALUE="&#2348;&#2367;');
    expect(supplySaveXml(draft, "बिजली नहीं")).toMatch(/^[\x20-\x7e]*$/); // ASCII on the wire
  });
  test("place names match across UPPCL's spellings", () => {
    expect(placeKey("EUDD IV RAMPUR")).toBe(placeKey("EUDD-4 RAMPUR"));
    expect(placeKey("Test Nagar Phase 2")).toBe(placeKey("Test nagar Phase-II"));
    expect(placeKey("EUDD-1 RAMPUR")).not.toBe(placeKey("EUDD-4 RAMPUR"));
  });
  test("complaint number from 1912's message", () => {
    expect(complaintNoIn("Your complaint for SUPPLY RELATED has been registered successfully. Your Complaint No. is MV01012600001")).toBe("MV01012600001");
    expect(complaintNoIn("Your complaint has been registered successfully")).toBeNull();
  });
  test("answers split per requested control", () => {
    const raw = '<RESULT EVENT_CONTROL="0.0"><RESULTS CHILDCONTROLID="59929" AC_ID="60180" SECCONTROLID=""><Rowset><DATA_ID>1001</DATA_ID><DISTRICT>TESTPUR</DISTRICT></Rowset></RESULTS>' +
      '<RESULTS CHILDCONTROLID="151532" AC_ID="210295" SECCONTROLID=""><Rowset><VAL>0</VAL></Rowset></RESULTS><RESULTS CHILDCONTROLID="59941" AC_ID="85043" SECCONTROLID=""></RESULTS></RESULT>';
    const r = parseByChild(raw);
    expect(r["59929"]).toEqual([{ DATA_ID: "1001", DISTRICT: "TESTPUR" }]);
    expect(r["151532"][0].VAL).toBe("0");
    expect(r["59941"]).toEqual([]);
  });
});

describe("pickDistrict", () => {
  const all = [{ id: "1", name: "RAMPUR" }, { id: "2", name: "GAUTAM BUDDHA NAGAR" }, { id: "3", name: "MAU" }, { id: "4", name: "AZAMGARH" }];
  test("picked by the user wins", () => expect(pickDistrict(all, { districtId: "3", city: "RAMPUR" })?.id).toBe("3"));
  test("bill address city", () => expect(pickDistrict(all, { city: "Rampur" })?.id).toBe("1"));
  test("city isn't a district: the district inside the division", () =>
    expect(pickDistrict(all, { city: "NOIDA", division: "EUDD II GAUTAM BUDDHA NAGAR" })?.id).toBe("2"));
  test("nothing matches: undefined (the user picks)", () => expect(pickDistrict(all, { city: "NOIDA", division: "EDD X" })).toBeUndefined());
});

describe("withContact", () => {
  const d = { controls: { 59944: "9000000000" } } as never;
  test("a valid second number is saved with who it belongs to", () =>
    expect((withContact(d, "+91 90000 00001", "Family") as { controls: Record<string, string> }).controls).toMatchObject({ 143142: "9000000001", 143626: "Family" }));
  test("not a mobile number: nothing saved", () =>
    expect((withContact(d, "12345", "Others") as { controls: Record<string, string> }).controls).toMatchObject({ 143142: "", 143626: "" }));
});
