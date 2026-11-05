const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAmortizationSchedule, calculatePenalty } = require("../src/utils/amortization");

// NOTE: buildAmortizationSchedule's second argument is a MONTHLY
// Percentage Rate (MPR), not an annual rate — see the rationale comment
// in src/utils/amortization.js. The numeric rate values below (e.g. 24)
// are chosen to exercise the algorithm's correctness (sums, zero-balance
// termination, monotonic interest decay) and are deliberately NOT meant
// to represent realistic real-world monthly rates for every test — the
// dedicated "matches the live-approved P2,000 loan" test below is the
// one that pins an actual real product rate (2.5% MPR).

test("reducing-balance schedule: total principal repaid equals loan amount", () => {
  const schedule = buildAmortizationSchedule(10000, 24, 12, new Date("2026-01-15"));
  const totalPrincipal = schedule.reduce((s, r) => s + r.principalDue, 0);
  assert.ok(Math.abs(totalPrincipal - 10000) < 0.01, `expected ~10000, got ${totalPrincipal}`);
});

test("reducing-balance schedule: final closing balance is exactly zero", () => {
  const schedule = buildAmortizationSchedule(10000, 24, 12, new Date("2026-01-15"));
  assert.equal(schedule[schedule.length - 1].closingBalance, 0);
});

test("reducing-balance schedule: interest decreases each month as balance shrinks", () => {
  const schedule = buildAmortizationSchedule(10000, 24, 12, new Date("2026-01-15"));
  for (let i = 1; i < schedule.length; i++) {
    assert.ok(
      schedule[i].interestDue <= schedule[i - 1].interestDue,
      `interest should be non-increasing month over month (row ${i})`
    );
  }
});

test("zero-interest edge case does not divide by zero and sums correctly", () => {
  const schedule = buildAmortizationSchedule(1200, 0, 12, new Date("2026-01-01"));
  const total = schedule.reduce((s, r) => s + r.principalDue, 0);
  assert.ok(Math.abs(total - 1200) < 0.01);
  assert.equal(schedule[0].interestDue, 0);
});

test("invalid inputs are rejected", () => {
  assert.throws(() => buildAmortizationSchedule(-100, 24, 12, new Date()));
  assert.throws(() => buildAmortizationSchedule(1000, 24, 0, new Date()));
  assert.throws(() => buildAmortizationSchedule(1000, 24, 1.5, new Date()));
  assert.throws(() => buildAmortizationSchedule(1000, -5, 12, new Date()));
});

test("matches the live-approved P2,000 loan (2.5% MPR, 6 months → P363.10/month)", () => {
  // This is a real value produced by an actual application-approval call
  // against a running instance of this system (see project README /
  // integration test log) — kept as a regression anchor so a future
  // change to the rate convention or rounding cannot silently drift the
  // real monthly installment customers are quoted.
  const schedule = buildAmortizationSchedule(2000, 2.5, 6, new Date("2026-07-15"));
  assert.equal(schedule[0].totalDue, 363.1);
  assert.equal(schedule[schedule.length - 1].closingBalance, 0);
});

test("penalty: normal case within cap", () => {
  assert.equal(calculatePenalty(1000, 1, 5), 50);
});

test("penalty: requested rate above regulatory 5% cap is clamped", () => {
  assert.equal(calculatePenalty(1000, 1, 20), 50);
});

test("penalty: lifetime total never exceeds outstanding principal", () => {
  assert.equal(calculatePenalty(1000, 1, 5, 980), 20);
  assert.equal(calculatePenalty(1000, 1, 5, 1000), 0);
});
