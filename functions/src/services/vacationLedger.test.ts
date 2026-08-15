import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveEntryVacationHours as eff,
  entitlementHours,
  projectLedger,
  remainingHours,
  sumConsumed,
  LedgerMonth,
} from "./vacationLedger";
import { YEARLY_ENTITLEMENT_HOURS } from "./vacationYearRollover";

/** Minimal ledger month cell — only `hours` is read by the maths under test. */
const m = (hours: number): LedgerMonth => ({
  hours,
  source: "payroll-lock",
  updatedAt: null,
  updatedBy: null,
});

test("effective vacation hours follow manual → auto → computed", () => {
  assert.equal(eff({ vacationHours: 16 }), 16);
  assert.equal(eff({ vacationHours: 16, autoOverrides: { vacationHours: 8 } }), 8);
  assert.equal(
    eff({ vacationHours: 16, autoOverrides: { vacationHours: 8 }, overrides: { vacationHours: 4 } }),
    4
  );
  assert.equal(eff({}), 0);
});

// The `??` in effectiveEntryVacationHours is load-bearing: with `||` an override
// of ZERO — "this person took no leave after all" — would fall through to the
// computed figure and keep deducting hours the employee never spent. Both the
// ledger feed on lock and the projected badge read through this one function, so
// the bug would land in the stored ledger, not just on screen.
test("an override of 0 wins over a non-zero computed value", () => {
  assert.equal(eff({ vacationHours: 24, overrides: { vacationHours: 0 } }), 0);
  assert.equal(eff({ vacationHours: 24, autoOverrides: { vacationHours: 0 } }), 0);
});

test("Nárok is null only when BOTH parts are unset", () => {
  assert.equal(entitlementHours(null, null), null);
  assert.equal(entitlementHours(160, null), 160);
  assert.equal(entitlementHours(null, 200), 200);
  assert.equal(entitlementHours(-8, 200), 192); // carried-over deficit
});

test("remaining = Nárok − Σ months − proplaceno", () => {
  const months = { "1": m(8), "2": m(0), "5": m(40) };
  assert.equal(sumConsumed(months), 48);
  assert.equal(
    remainingHours({ priorYearHours: 40, currentYearHours: 200, paidOutHours: 16, months }),
    176
  );
  // No entitlement set → no balance to report, NOT zero.
  assert.equal(
    remainingHours({ priorYearHours: null, currentYearHours: null, paidOutHours: null, months }),
    null
  );
  // May go negative — the ledger permits an over-drawn balance.
  assert.equal(
    remainingHours({ priorYearHours: 0, currentYearHours: 40, paidOutHours: null, months }),
    -8
  );
});

// ── projectLedger — the ONE shape every read path returns ────────────────────
// Extracted from readLedger so the per-employee GET, the self-service GET and
// the aggregate overview table cannot drift apart. These pin the contract.

test("projectLedger derives Nárok, Čerpáno and Zůstatek from the stored parts", () => {
  const out = projectLedger(
    {
      priorYearHours: 64,
      currentYearHours: 13,
      paidOutHours: 5,
      months: { "1": m(72) },
    },
    2026
  );
  assert.equal(out.year, 2026);
  assert.equal(out.entitlementHours, 77); // 64 + 13
  assert.equal(out.consumedHours, 72);
  assert.equal(out.remainingHours, 0); // 77 − 72 − 5, the real Špak Josef row
});

test("projectLedger keeps a negative Proplaceno and lets it raise the balance", () => {
  // Alkin Arman: leave taken overran the entitlement, so Propl. is the negative
  // balancing figure AVENSIO carries. Subtracting it must ADD back.
  const out = projectLedger(
    { priorYearHours: 0, currentYearHours: 40, paidOutHours: -22, months: { "3": m(52), "4": m(10) } },
    2026
  );
  assert.equal(out.paidOutHours, -22);
  assert.equal(out.remainingHours, 0); // 40 − 62 − (−22)
});

test("projectLedger returns null Nárok and Zůstatek when both parts are unset", () => {
  const out = projectLedger({ months: { "1": m(8) } }, 2026);
  assert.equal(out.entitlementHours, null);
  assert.equal(out.remainingHours, null);
  assert.equal(out.consumedHours, 8); // Čerpáno still counts
});

test("projectLedger rounds away float noise in the derived figures", () => {
  // Thirds of an hour are real in payroll; summing them unrounded surfaces
  // 127.99999999999999 in a column forty rows tall.
  const out = projectLedger(
    { priorYearHours: 0, currentYearHours: 128, paidOutHours: null, months: { "1": m(0.1), "2": m(0.2) } },
    2026
  );
  assert.equal(out.consumedHours, 0.3);
  assert.equal(out.remainingHours, 127.7);
});

test("projectLedger tolerates a document with no months map", () => {
  const out = projectLedger({ priorYearHours: 4, currentYearHours: 53, paidOutHours: 57 }, 2026);
  assert.equal(out.consumedHours, 0);
  assert.equal(out.remainingHours, 0); // 57 − 0 − 57, the Dvořáková row
});

// ── Yearly rollover constants ────────────────────────────────────────────────

test("yearly entitlement is sized by contract type, and only those three types", () => {
  assert.equal(YEARLY_ENTITLEMENT_HOURS.HPP, 160);
  assert.equal(YEARLY_ENTITLEMENT_HOURS.PPP, 80);
  assert.equal(YEARLY_ENTITLEMENT_HOURS.DPP, 0);
  // An unknown or empty contract type must be absent, not defaulted — the
  // rollover reports those employees instead of guessing an entitlement.
  assert.equal(YEARLY_ENTITLEMENT_HOURS[""], undefined);
  assert.equal(YEARLY_ENTITLEMENT_HOURS.DPC, undefined);
});

test("a DPP entitlement of 0 is a real value, not a missing one", () => {
  // Guards the rollover's `hours === undefined` test: `!hours` would skip every
  // DPP employee and leave their year unseeded.
  assert.notEqual(YEARLY_ENTITLEMENT_HOURS.DPP, undefined);
  assert.equal(entitlementHours(null, YEARLY_ENTITLEMENT_HOURS.DPP), 0);
});
