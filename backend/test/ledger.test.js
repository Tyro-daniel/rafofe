const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/utils/ledger");

test("disbursement entries balance", () => {
  assert.ok(L.isBalanced(L.buildDisbursementEntries(1, 100, 10000)));
});

test("repayment entries balance (principal + interest split)", () => {
  assert.ok(L.isBalanced(L.buildRepaymentEntries(1, 101, 745.6, 200)));
});

test("repayment entries balance (principal only, final installment)", () => {
  assert.ok(L.isBalanced(L.buildRepaymentEntries(1, 101, 500, 0)));
});

test("penalty entries balance", () => {
  assert.ok(L.isBalanced(L.buildPenaltyEntries(1, 102, 50)));
});

test("write-off entries balance", () => {
  assert.ok(L.isBalanced(L.buildWriteOffEntries(1, 103, 927.01)));
});

test("isBalanced correctly flags a deliberately unbalanced set", () => {
  const fake = [{ loan_account_id: 1, transaction_id: 1, account_name: "x", entry_type: "debit", amount: 100 }];
  assert.equal(L.isBalanced(fake), false);
});

test("zero or negative amounts are rejected", () => {
  assert.throws(() => L.buildDisbursementEntries(1, 100, 0));
  assert.throws(() => L.buildPenaltyEntries(1, 100, -10));
  assert.throws(() => L.buildRepaymentEntries(1, 100, 0, 0));
});
