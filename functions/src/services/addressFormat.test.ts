import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCzechAddressConnector as n, normalizeContactAddresses } from "./addressFormat";

test("single-word pair → tight spojovník (no spaces)", () => {
  assert.equal(n("Frýdek - Místek"), "Frýdek-Místek");
  assert.equal(n("Praha – Kunratice"), "Praha-Kunratice");
  assert.equal(n("V Jahodách 404, Praha – Kunratice, 148 00"), "V Jahodách 404, Praha-Kunratice, 148 00");
});

test("multi-word part (Praha N) → spaced en-dash", () => {
  assert.equal(n("Daškova 8, Praha 4 - Modřany, 143 00"), "Daškova 8, Praha 4 – Modřany, 143 00");
  assert.equal(n("Na Dolinách 17, Praha 4-Podolí, 147 00"), "Na Dolinách 17, Praha 4 – Podolí, 147 00");
  assert.equal(n("Brandýs nad Labem-Stará Boleslav"), "Brandýs nad Labem – Stará Boleslav");
});

test("em-dash is never produced", () => {
  assert.equal(n("Frýdek—Místek"), "Frýdek-Místek");
  assert.equal(n("Praha 10—Vršovice"), "Praha 10 – Vršovice");
  assert.ok(!n("Praha 10—Vršovice").includes("—"));
});

test("already-correct values are unchanged (idempotent)", () => {
  assert.equal(n("Frýdek-Místek"), "Frýdek-Místek");
  assert.equal(n("Praha 4 – Modřany"), "Praha 4 – Modřany");
  assert.equal(n(n("Praha 4-Podolí")), n("Praha 4-Podolí"));
});

test("house ranges and dash-free text are untouched", () => {
  assert.equal(n("Dlouhá 12-14, Praha"), "Dlouhá 12-14, Praha");
  assert.equal(n("U Lesa 3, Brno"), "U Lesa 3, Brno");
});

test("normalizeContactAddresses only touches the two address fields", () => {
  const out = normalizeContactAddresses({
    phone: "+420 123 456 789",
    permanentAddress: "Praha 4-Podolí",
    contactAddress: "Frýdek - Místek",
    email: "a@b.cz",
  });
  assert.equal(out.permanentAddress, "Praha 4 – Podolí");
  assert.equal(out.contactAddress, "Frýdek-Místek");
  assert.equal(out.phone, "+420 123 456 789");
  assert.equal(out.email, "a@b.cz");
});
