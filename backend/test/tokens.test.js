const test = require("node:test");
const assert = require("node:assert/strict");
const { generateRawToken, hashToken, minutesFromNow } = require("../src/utils/tokens");

test("generateRawToken produces unique, 64-character hex tokens", () => {
  const t1 = generateRawToken();
  const t2 = generateRawToken();
  assert.notEqual(t1, t2);
  assert.equal(t1.length, 64);
  assert.match(t1, /^[0-9a-f]{64}$/);
});

test("hashToken is deterministic (same input -> same output)", () => {
  const t = generateRawToken();
  assert.equal(hashToken(t), hashToken(t));
});

test("hashToken produces a different value from the raw token (not reversible/identity)", () => {
  const t = generateRawToken();
  assert.notEqual(hashToken(t), t);
});

test("hashToken produces different hashes for different tokens", () => {
  const t1 = generateRawToken();
  const t2 = generateRawToken();
  assert.notEqual(hashToken(t1), hashToken(t2));
});

test("minutesFromNow produces a timestamp the correct distance in the future", () => {
  const before = Date.now();
  const future = minutesFromNow(60);
  const diffMinutes = (future.getTime() - before) / 60000;
  assert.ok(diffMinutes > 59.9 && diffMinutes < 60.1, `expected ~60 minutes, got ${diffMinutes}`);
});

test("minutesFromNow(0) is effectively now, not in the past", () => {
  const now = Date.now();
  const result = minutesFromNow(0);
  assert.ok(result.getTime() >= now - 100);
});
