/**
 * NAVÍC (`extraPay`) is stored as a raw NET amount. What payroll reports is the
 * gross figure: below 5 000 net it is grossed up (÷ 0.85, ceil to 100); from
 * 5 000 net the gross part is capped at 6 000 and the rest stays net
 * (`navicNetRemainder`), paid outside the payslip.
 *
 * Shared by the Payroll table, its PDF export and the payroll check (the gross
 * part is what the XLS "Pohyblivá složka" and payslip code 528 carry).
 */
export const NAVIC_GROSS_CAP = 6000;
export const NAVIC_NET_CAP = 5000;

export function navicGross(extraPay: number): number {
  if (!extraPay || extraPay <= 0) return 0;
  if (extraPay < NAVIC_NET_CAP) return Math.ceil(extraPay / 0.85 / 100) * 100;
  return NAVIC_GROSS_CAP;
}

export function navicNetRemainder(extraPay: number): number {
  return extraPay > NAVIC_NET_CAP ? extraPay - NAVIC_NET_CAP : 0;
}
