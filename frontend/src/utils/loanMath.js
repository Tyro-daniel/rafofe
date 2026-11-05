/**
 * Client-side repayment ESTIMATE for the application form, so a customer
 * can see roughly what they're committing to before they submit — good
 * UX, arguably essential for responsible lending.
 *
 * RATE CONVENTION: `monthlyRatePct` is a MONTHLY Percentage Rate (MPR),
 * matching the backend's storage/calculation convention (see backend
 * src/utils/amortization.js for the full rationale). Do NOT divide this
 * by 12 anywhere — that conversion was removed system-wide when the
 * product switched from quoting APR to quoting MPR directly.
 *
 * This mirrors the reducing-balance formula in the backend's
 * src/utils/amortization.js (buildAmortizationSchedule). It is
 * intentionally a separate, simpler implementation:
 *   - the backend version is the single source of truth that actually
 *     gets persisted to schedule_entries and is legally what the customer
 *     signs in their loan agreement;
 *   - this one only needs the monthly figure and totals, not a full
 *     month-by-month schedule, so a full duplicate of the backend's
 *     rounding/edge-case handling isn't justified here.
 * If the interest calculation MODEL ever changes (e.g. flat-rate
 * instead of reducing-balance), both this file and backend
 * src/utils/amortization.js need to change together — that coupling is
 * called out explicitly here so it isn't missed in a future refactor.
 */
export function estimateMonthlyInstallment(principal, monthlyRatePct, tenureMonths) {
  if (!(principal > 0) || !(tenureMonths > 0)) return null;

  const monthlyRate = monthlyRatePct / 100;
  const monthlyInstallment =
    monthlyRate === 0
      ? principal / tenureMonths
      : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -tenureMonths));

  const totalRepayable = monthlyInstallment * tenureMonths;
  const totalInterest = totalRepayable - principal;

  return {
    monthlyInstallment: round2(monthlyInstallment),
    totalRepayable: round2(totalRepayable),
    totalInterest: round2(totalInterest),
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
