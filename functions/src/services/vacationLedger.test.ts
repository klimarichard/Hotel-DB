import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveEntryVacationHours as eff,
  entitlementHours,
  remainingHours,
  sumConsumed,
  LedgerMonth,
} from "./vacationLedger";

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
