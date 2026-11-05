/**
 * Double-entry ledger helpers.
 *
 * Every financial event produces a balanced pair (or set) of entries:
 * total debits === total credits. This module only builds the entry
 * objects — persistence happens in the routes layer inside a DB
 * transaction, so a partially-written ledger can never occur.
 */

const { round2 } = require("./amortization");

/**
 * Disbursement: money leaves the company's cash account and becomes
 * a receivable owed by the customer.
 *   Dr Loan Receivable   (asset up)
 *   Cr Cash               (asset down)
 */
function buildDisbursementEntries(loanAccountId, transactionId, amount) {
  assertPositive(amount, "disbursement amount");
  return [
    entry(loanAccountId, transactionId, "loan_receivable", "debit", amount),
    entry(loanAccountId, transactionId, "cash", "credit", amount),
  ];
}

/**
 * Repayment: customer pays back part principal, part interest.
 *   Dr Cash                       (asset up, total payment)
 *   Cr Loan Receivable            (asset down, principal portion)
 *   Cr Interest Income            (revenue up, interest portion)
 */
function buildRepaymentEntries(loanAccountId, transactionId, principalPortion, interestPortion) {
  assertNonNegative(principalPortion, "principalPortion");
  assertNonNegative(interestPortion, "interestPortion");
  const total = round2(principalPortion + interestPortion);
  if (total <= 0) throw new Error("repayment total must be > 0");

  const entries = [entry(loanAccountId, transactionId, "cash", "debit", total)];
  if (principalPortion > 0) {
    entries.push(entry(loanAccountId, transactionId, "loan_receivable", "credit", principalPortion));
  }
  if (interestPortion > 0) {
    entries.push(entry(loanAccountId, transactionId, "interest_income", "credit", interestPortion));
  }
  return entries;
}

/**
 * Penalty charge: adds to what the customer owes and books penalty income.
 *   Dr Loan Receivable
 *   Cr Penalty Income
 */
function buildPenaltyEntries(loanAccountId, transactionId, amount) {
  assertPositive(amount, "penalty amount");
  return [
    entry(loanAccountId, transactionId, "loan_receivable", "debit", amount),
    entry(loanAccountId, transactionId, "penalty_income", "credit", amount),
  ];
}

/**
 * Write-off: the company accepts it will not collect the remaining
 * receivable and moves it to a bad-debt expense.
 *   Dr Bad Debt Expense
 *   Cr Loan Receivable
 */
function buildWriteOffEntries(loanAccountId, transactionId, amount) {
  assertPositive(amount, "write-off amount");
  return [
    entry(loanAccountId, transactionId, "bad_debt_expense", "debit", amount),
    entry(loanAccountId, transactionId, "loan_receivable", "credit", amount),
  ];
}

function entry(loanAccountId, transactionId, accountName, entryType, amount) {
  return {
    loan_account_id: loanAccountId,
    transaction_id: transactionId,
    account_name: accountName,
    entry_type: entryType, // 'debit' | 'credit'
    amount: round2(amount),
  };
}

/** Sanity check: every generated entry set must balance. Used in tests and can be called before insert. */
function isBalanced(entries) {
  const debits = entries.filter((e) => e.entry_type === "debit").reduce((s, e) => s + e.amount, 0);
  const credits = entries.filter((e) => e.entry_type === "credit").reduce((s, e) => s + e.amount, 0);
  return round2(debits) === round2(credits);
}

function assertPositive(n, label) {
  if (!(n > 0)) throw new Error(`${label} must be > 0`);
}
function assertNonNegative(n, label) {
  if (n < 0) throw new Error(`${label} must be >= 0`);
}

module.exports = {
  buildDisbursementEntries,
  buildRepaymentEntries,
  buildPenaltyEntries,
  buildWriteOffEntries,
  isBalanced,
};
