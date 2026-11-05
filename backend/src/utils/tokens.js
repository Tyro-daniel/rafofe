/**
 * Token generation/hashing for email verification and password reset.
 *
 * SECURITY PRINCIPLE: the raw token is only ever sent to the user (in the
 * email link) and NEVER stored anywhere. Only a SHA-256 hash of it is
 * persisted in the database. This mirrors why passwords are hashed:
 * if the database were ever compromised, an attacker with read access
 * to `users` gets USELESS hashes — they cannot reconstruct a working
 * verification/reset link from them, the same way they cannot
 * reconstruct a working password from a bcrypt hash.
 *
 * Tokens are also always issued with an expiry (see callers), so even a
 * genuinely leaked raw token (e.g. from an email provider's logs) stops
 * being useful after a short, bounded window.
 */
const crypto = require("crypto");

/** 32 random bytes -> 64 hex characters. Cryptographically secure (not Math.random). */
function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

/** One-way hash of a raw token, for storage/lookup. Not reversible. */
function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

module.exports = { generateRawToken, hashToken, minutesFromNow };
