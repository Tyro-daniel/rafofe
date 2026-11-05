/**
 * Loan amortization + interest utilities.
 * Pure functions, no external dependencies — deliberately kept this way so
 * they can be unit tested in isolation from the database/HTTP layer.
 *
 * Default method: REDUCING BALANCE (recommended in the design doc for
 * micro-lending: fairer to the borrower than flat-rate interest, and the
 * industry-standard method examiners/regulators expect to see).
 */

/**
 * Build a full amortization schedule using the reducing-balance method.
 *
 * RATE CONVENTION: this system quotes and stores interest as MONTHLY
 * PERCENTAGE RATE (MPR), not Annual Percentage Rate (APR). This was a
 * deliberate change (previously the system used APR ÷ 12) — MPR is what
 * is actually disclosed to the borrower on their loan agreement in this
 * product line, so storing and calculating in the same unit avoids a
 * conversion step (and a conversion bug) between what's stored, what's
 * calculated, and what's shown to the customer. If you ever need to
 * display an equivalent APR for comparison purposes, multiply by 12 —
 * do NOT divide by 12 anywhere in this function.
 *
 * @param {number} principal - loan amount
 * @param {number} monthlyRatePct - MONTHLY interest rate as a percentage, e.g. 2.5 for 2.5%/month
 * @param {number} tenureMonths - number of monthly installments
 * @param {Date} startDate - date of first disbursement; first installment is due 1 month later
 * @returns {Array<{
 *   installmentNo: number,
 *   dueDate: string,
 *   openingBalance: number,
 *   principalDue: number,
 *   interestDue: number,
 *   totalDue: number,
 *   closingBalance: number
 * }>}
 */
function buildAmortizationSchedule(principal, monthlyRatePct, tenureMonths, startDate) {
  if (principal <= 0) throw new Error("principal must be > 0");
  if (tenureMonths <= 0 || !Number.isInteger(tenureMonths)) {
    throw new Error("tenureMonths must be a positive integer");
  }
  if (monthlyRatePct < 0) throw new Error("monthlyRatePct must be >= 0");

  const monthlyRate = monthlyRatePct / 100;

  // Standard amortized payment formula. Guard the zero-interest edge case
  // (division by zero if monthlyRate === 0).
  const fixedInstallment =
    monthlyRate === 0
      ? round2(principal / tenureMonths)
      : round2(
          (principal * monthlyRate) /
            (1 - Math.pow(1 + monthlyRate, -tenureMonths))
        );

  const schedule = [];
  let balance = principal;

  for (let i = 1; i <= tenureMonths; i++) {
    const openingBalance = round2(balance);
    const interestDue = round2(balance * monthlyRate);

    // On the final installment, pay off whatever balance remains exactly,
    // so rounding drift over the life of the loan doesn't leave a residual.
    let principalDue = round2(fixedInstallment - interestDue);
    let totalDue = round2(principalDue + interestDue);

    if (i === tenureMonths) {
      principalDue = round2(balance);
      totalDue = round2(principalDue + interestDue);
    }

    balance = round2(balance - principalDue);

    const dueDate = addMonths(startDate, i);

    schedule.push({
      installmentNo: i,
      dueDate: dueDate.toISOString().slice(0, 10),
      openingBalance,
      principalDue,
      interestDue,
      totalDue,
      closingBalance: Math.max(balance, 0),
    });
  }

  return schedule;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Late fee / penalty calculator, hard-capped per Botswana Microlending
 * Regulations bad-debt/delinquency guidance: penalties must not exceed 5%
 * of the outstanding principal per month, and total penalties must never
 * exceed the outstanding principal amount.
 *
 * @param {number} outstandingPrincipal
 * @param {number} monthsLate
 * @param {number} penaltyRatePct - e.g. 5 for 5%/month (must be <= 5 by regulation)
 * @param {number} penaltiesAlreadyCharged - lifetime total already applied to this loan
 */
function calculatePenalty(outstandingPrincipal, monthsLate, penaltyRatePct, penaltiesAlreadyCharged = 0) {
  const CAP_RATE_PCT = 5; // regulatory ceiling
  const effectiveRate = Math.min(penaltyRatePct, CAP_RATE_PCT);

  let penalty = round2(outstandingPrincipal * (effectiveRate / 100) * Math.max(monthsLate, 0));

  const remainingHeadroom = round2(outstandingPrincipal - penaltiesAlreadyCharged);
  penalty = Math.min(penalty, Math.max(remainingHeadroom, 0));

  return round2(penalty);
}

module.exports = { buildAmortizationSchedule, calculatePenalty, round2 };
