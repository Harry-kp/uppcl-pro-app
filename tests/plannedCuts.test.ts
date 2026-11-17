import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { inflate } from "../shared/inflate";
import { COLS, parsePlannedCuts } from "../shared/plannedCuts";
import { nameScore, SAME_NAME } from "../shared/plannedCuts";

test("inflate round-trips stored, fixed and dynamic blocks", () => {
  const text = new TextEncoder().encode("BT (HELLO) Tj ET ".repeat(500) + Math.random());
  for (const level of [0, 1, 9]) expect(inflate(new Uint8Array(deflateSync(text, { level })))).toEqual(text);
});

// Synthetic Excel-style page: 14 columns, a header, two feeder rows sharing one merged sub-station cell, one NIL zone.
function pdf(): Uint8Array {
  const xs = Array.from({ length: COLS.length + 1 }, (_, i) => 10 + i * 50);
  const cell = (c: number, y: number, s: string) => `BT\n/F1 7 Tf\n1 0 0 1 ${xs[c] + 2} ${y} Tm\n[(${s})] TJ\nET\n`;
  const hline = (y: number, c0 = 0, c1 = COLS.length) => `${xs[c0]} ${y} ${xs[c1] - xs[c0]} 0.12 re\nf*\n`;
  let s = xs.map((x) => `${x} 100 0.12 400 re\nf*\n`).join("") + hline(500) + hline(480) + hline(460) + hline(440, 5) + hline(420) + hline(100);
  s += cell(1, 485, "ZONE") + cell(0, 465, "1") + cell(1, 465, "TESTZONE") + cell(7, 465, "NIL");
  s += cell(1, 435, "MEERUT-1") + cell(4, 435, "PALLAVPURAM PH-2") + cell(4, 428, "\\(NEW\\)");
  for (const [y, f] of [[445, "FEEDER NO-1"], [425, "FEEDER NO-2"]] as const)
    s += cell(5, y, f) + cell(6, y, "HP1") + cell(8, y, "18-11-2026") + cell(9, y, "10:00") + cell(10, y, "12:00");
  const z = Buffer.from(deflateSync(Buffer.from(s, "latin1"))).toString("latin1");
  const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Count 1/Kids[ 3 0 R]>>",
    "<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
    `<</Filter/FlateDecode/Length ${z.length}>>\r\nstream\r\n${z}\r\nendstream`, "<</Type/Font/BaseFont/Arial>>"];
  const body = "%PDF-1.4\r\n" + objs.map((o, i) => `${i + 1} 0 obj\r\n${o}\r\nendobj\r\n`).join("") + "trailer\r\n<</Root 1 0 R>>\r\n%%EOF";
  return new Uint8Array(Buffer.from(body, "latin1"));
}

test("rows come out with merged cells filled in, NIL zones listed", () => {
  const r = parsePlannedCuts(pdf());
  expect(r.problems).toEqual([]);
  expect(r.nil).toEqual(["TESTZONE"]);
  expect(r.cuts.map((c) => [c.zone, c.substation, c.feeder, c.from, c.to])).toEqual([
    ["MEERUT-1", "PALLAVPURAM PH-2 (NEW)", "FEEDER NO-1", "10:00", "12:00"],
    ["MEERUT-1", "PALLAVPURAM PH-2 (NEW)", "FEEDER NO-2", "10:00", "12:00"],
  ]);
});

test("names match across spellings, never across numbers", () => {
  expect(nameScore("Pallavpuram Phase-II", "PALLAVPURAM PH-2 (NEW)")).toBeGreaterThanOrEqual(SAME_NAME);
  expect(nameScore("Kankar Khera Rural", "KANKER KHERA (RURAL)")).toBeGreaterThanOrEqual(SAME_NAME);
  expect(nameScore("Pallavpuram Phase-I", "PALLAVPURAM PHASE-II")).toBe(0);
  expect(nameScore("Pallavpuram Phase-II", "GOVINDPURAM")).toBeLessThan(SAME_NAME);
});

test("the user's cuts: name + city match, split windows, ended ones dropped, soonest first", () => {
  const { myPlannedCuts, windowsOf, cityOf } = require("../shared/plannedCuts") as typeof import("../shared/plannedCuts");
  const row = (substation: string, place: string, date: string, from: string, to: string) =>
    ({ substation, feeder: "F1", place, date, from, to, reason: null, area: null });
  expect(windowsOf(row("A", "", "17.11.2026", "10:00 & 15:00", "12:00 & 17:00")).map((w) => [w.start.getHours(), w.end.getHours()])).toEqual([[10, 12], [15, 17]]);
  expect(windowsOf(row("A", "", "bad", "10:00", "12:00"))).toEqual([]);
  expect(cityOf("EUDSD-13 Meerut")).toBe("Meerut");
  const list = { url: "x", cuts: [
    row("PALLAVPURAM PH-2", "MEERUT-1 EUDC-1 MEERUT", "18-11-2026", "10:00", "14:00"),
    row("PALLAVPURAM PH-2", "SAHARANPUR EUDC SAHARANPUR", "18-11-2026", "09:00", "11:00"), // same name, other city
    row("PALLAVPURAM PH-1", "MEERUT-1 EUDC-1 MEERUT", "18-11-2026", "08:00", "09:00"), // other number
    row("PALLAVPURAM PHASE II", "MEERUT-1 EUDC-1 MEERUT", "17-11-2026", "06:00", "07:00"), // already over
    row("PALLAVPURAM PHASE II", "MEERUT-1 EUDC-1 MEERUT", "17-11-2026", "07:30", "20:00"), // running now
    row("PALLAVPURAM PHASE II", "MEERUT-1 EUDC-1 MEERUT", "20-11-2026", "10:00", "12:00"), // too far ahead
  ] };
  const now = new Date(2026, 10, 17, 8, 0);
  const got = myPlannedCuts(list, { substation: "Pallavpuram Phase-II", city: "Meerut" }, now);
  expect(got.map((c) => [c.date, c.from])).toEqual([["17-11-2026", "07:30"], ["18-11-2026", "10:00"]]);
});
