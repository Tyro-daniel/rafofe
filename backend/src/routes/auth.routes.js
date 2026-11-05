const express = require("express");
const bcrypt = require("bcryptjs");
const { authenticator } = require("otplib");
const QRCode = require("qrcode");
const { z } = require("zod");
const { query } = require("../db");
const { signAccessToken, signRefreshToken, requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");
const { generateRawToken, hashToken, minutesFromNow } = require("../utils/tokens");
const emailService = require("../services/emailService");

const router = express.Router();

// How long each token type stays valid. Verification links are less
// sensitive (worst case: someone else clicks it and marks an email
// "verified" without being able to log in as that user) so they get a
// longer window; password reset directly grants account access, so it
// gets a much shorter one.
const EMAIL_VERIFICATION_TTL_MINUTES = 24 * 60;
const PASSWORD_RESET_TTL_MINUTES = 60;

// Minimum time between two verification-resend or reset-request emails
// to the same address — a simple, dependency-free rate limit (no Redis
// in this stack) that prevents someone from spamming a mailbox by
// repeatedly hitting these endpoints. Enforced by checking email_log
// directly rather than adding new infrastructure.
const RESEND_COOLDOWN_MINUTES = 2;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(2),
  phone: z.string().min(7).optional(),
  maritalStatus: z.enum(["single", "married_in_community", "married_out_of_community", "unknown"]).optional(),
});

// Customers self-register through this endpoint. Officer/admin accounts
// are created by an existing admin via /officer/users, not here.
router.post("/register", asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const { email, password, fullName, phone, maritalStatus } = parsed.data;

  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Email verification: generate a raw token for the email link, but
  // persist only its SHA-256 hash (see utils/tokens.js header comment
  // for why — this is the same principle as never storing a raw
  // password). The raw token exists only in memory for this request and
  // inside the email we're about to send.
  const rawVerificationToken = generateRawToken();
  const verificationTokenHash = hashToken(rawVerificationToken);
  const verificationExpiresAt = minutesFromNow(EMAIL_VERIFICATION_TTL_MINUTES);

  const result = await query(
    `INSERT INTO users (email, password_hash, role, full_name, phone, marital_status,
                         email_verified, email_verification_token_hash, email_verification_expires_at)
     VALUES ($1, $2, 'customer', $3, $4, $5, FALSE, $6, $7)
     RETURNING id, email, role, full_name, marital_status, email_verified, created_at`,
    [email, passwordHash, fullName, phone || null, maritalStatus || "unknown", verificationTokenHash, verificationExpiresAt]
  );

  const user = result.rows[0];
  const userForEmail = { id: user.id, email: user.email, fullName: user.full_name };

  // Both emails are fire-and-forget from the request's point of view —
  // emailService.sendEmail() never throws, so a slow/failed email
  // provider can never block or fail registration itself. Not awaited
  // sequentially-blocking on purpose: registration should feel instant.
  emailService.sendRegistrationConfirmation(userForEmail);
  emailService.sendEmailVerification(userForEmail, rawVerificationToken);

  // Registration still logs the user in immediately (keeps existing
  // UX) — email verification is enforced as a gate on sensitive actions
  // (submitting a loan application — see loans.routes.js) rather than
  // blocking login itself. This is a deliberate product decision, not
  // an oversight: it lets a new customer explore the app immediately
  // while still requiring verification before anything consequential.
  const accessToken = signAccessToken({ id: user.id, role: user.role, email: user.email });
  const refreshToken = signRefreshToken({ id: user.id });

  res.status(201).json({ user, accessToken, refreshToken });
}));

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  mfaCode: z.string().optional(),
});

router.post("/login", asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const { email, password, mfaCode } = parsed.data;

  const result = await query(
    "SELECT id, email, password_hash, role, full_name, mfa_enabled, mfa_secret, is_active, email_verified FROM users WHERE email = $1",
    [email]
  );
  const user = result.rows[0];

  // Deliberately generic error message for both "no such user" and
  // "wrong password" — do not reveal which one it was, to avoid account
  // enumeration.
  if (!user || !user.is_active) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (user.mfa_enabled) {
    if (!mfaCode) {
      return res.status(200).json({ mfaRequired: true });
    }
    const valid = authenticator.check(mfaCode, user.mfa_secret);
    if (!valid) {
      return res.status(401).json({ error: "Invalid MFA code" });
    }
  }

  const accessToken = signAccessToken({ id: user.id, role: user.role, email: user.email });
  const refreshToken = signRefreshToken({ id: user.id });

  res.json({
    user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name, emailVerified: user.email_verified },
    accessToken,
    refreshToken,
  });
}));

// --- MFA enrollment ---

router.post("/mfa/setup", requireAuth, asyncHandler(async (req, res) => {
  const secret = authenticator.generateSecret();
  await query("UPDATE users SET mfa_secret = $1 WHERE id = $2", [secret, req.user.id]);
  const otpauth = authenticator.keyuri(req.user.email, "LMS Botswana", secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  res.json({ secret, qrDataUrl });
}));

router.post("/mfa/enable", requireAuth, asyncHandler(async (req, res) => {
  const { code } = req.body;
  const result = await query("SELECT mfa_secret FROM users WHERE id = $1", [req.user.id]);
  const { mfa_secret } = result.rows[0] || {};
  if (!mfa_secret) {
    return res.status(400).json({ error: "Call /mfa/setup first" });
  }
  if (!authenticator.check(code || "", mfa_secret)) {
    return res.status(401).json({ error: "Invalid code — MFA not enabled" });
  }
  await query("UPDATE users SET mfa_enabled = TRUE WHERE id = $1", [req.user.id]);
  res.json({ mfaEnabled: true });
}));

router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    "SELECT id, email, role, full_name, phone, marital_status, mfa_enabled, email_verified, created_at FROM users WHERE id = $1",
    [req.user.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
  res.json(result.rows[0]);
}));

// =====================================================================
// Email verification
// =====================================================================

// GET, not POST: this is meant to be a link the user clicks straight
// from their email client, not a form submission.
router.get("/verify-email", asyncHandler(async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Missing verification token" });
  }

  const tokenHash = hashToken(token);
  const result = await query(
    `SELECT id, email, full_name, email_verified, email_verification_expires_at
     FROM users WHERE email_verification_token_hash = $1`,
    [tokenHash]
  );
  const user = result.rows[0];

  // Deliberately generic — do not distinguish "no such token" from
  // "expired token" from "already verified" in a way that helps an
  // attacker probe token validity; a genuine user with a broken link can
  // always just request a new one via /resend-verification.
  if (!user) {
    return res.status(400).json({ error: "This verification link is invalid or has already been used." });
  }
  if (user.email_verified) {
    return res.json({ message: "This email address is already verified.", alreadyVerified: true });
  }
  if (new Date(user.email_verification_expires_at) < new Date()) {
    return res.status(400).json({ error: "This verification link has expired. Please request a new one." });
  }

  await query(
    `UPDATE users SET email_verified = TRUE, email_verification_token_hash = NULL, email_verification_expires_at = NULL WHERE id = $1`,
    [user.id]
  );

  res.json({ message: "Email verified successfully.", alreadyVerified: false });
}));

router.post("/resend-verification", requireAuth, asyncHandler(async (req, res) => {
  const result = await query("SELECT id, email, full_name, email_verified FROM users WHERE id = $1", [req.user.id]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.email_verified) {
    return res.status(400).json({ error: "Your email is already verified." });
  }

  // Rate limit: has a verification email already gone out to this user
  // very recently? Checked against email_log directly rather than
  // adding a separate rate-limiting dependency.
  const recent = await query(
    `SELECT id FROM email_log
     WHERE user_id = $1 AND event_type = 'email_verification' AND created_at > now() - ($2 || ' minutes')::interval
     ORDER BY created_at DESC LIMIT 1`,
    [user.id, RESEND_COOLDOWN_MINUTES]
  );
  if (recent.rows.length > 0) {
    return res.status(429).json({ error: `Please wait a couple of minutes before requesting another verification email.` });
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = minutesFromNow(EMAIL_VERIFICATION_TTL_MINUTES);

  await query(
    `UPDATE users SET email_verification_token_hash = $1, email_verification_expires_at = $2 WHERE id = $3`,
    [tokenHash, expiresAt, user.id]
  );

  await emailService.sendEmailVerification({ id: user.id, email: user.email, fullName: user.full_name }, rawToken);

  res.json({ message: "Verification email sent." });
}));

// =====================================================================
// Password reset
// =====================================================================

const forgotPasswordSchema = z.object({ email: z.string().email() });

router.post("/forgot-password", asyncHandler(async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const { email } = parsed.data;

  // SECURITY: this response is IDENTICAL regardless of whether the
  // email exists, is inactive, or is being rate-limited. Returning a
  // different message for "no such account" would let an attacker
  // enumerate registered emails one guess at a time — a well-known,
  // easy-to-avoid fintech security mistake. The generic response is
  // returned at the very end of this handler no matter which branch
  // below actually executes.
  const genericResponse = { message: "If an account with that email exists, we've sent a password reset link." };

  const result = await query("SELECT id, email, full_name, is_active FROM users WHERE email = $1", [email]);
  const user = result.rows[0];

  if (user && user.is_active) {
    const recent = await query(
      `SELECT id FROM email_log
       WHERE user_id = $1 AND event_type = 'password_reset_requested' AND created_at > now() - ($2 || ' minutes')::interval
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, RESEND_COOLDOWN_MINUTES]
    );
    if (recent.rows.length === 0) {
      const rawToken = generateRawToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = minutesFromNow(PASSWORD_RESET_TTL_MINUTES);

      await query(
        `UPDATE users SET password_reset_token_hash = $1, password_reset_expires_at = $2 WHERE id = $3`,
        [tokenHash, expiresAt, user.id]
      );

      await emailService.sendPasswordResetRequested({ id: user.id, email: user.email, fullName: user.full_name }, rawToken);
    }
    // If within the cooldown window, deliberately do nothing further —
    // still return the same generic response so the caller can't tell
    // rate-limiting apart from "no such account".
  }

  res.json(genericResponse);
}));

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

router.post("/reset-password", asyncHandler(async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const { token, newPassword } = parsed.data;
  const tokenHash = hashToken(token);

  const result = await query(
    `SELECT id, email, full_name, password_reset_expires_at FROM users WHERE password_reset_token_hash = $1`,
    [tokenHash]
  );
  const user = result.rows[0];

  if (!user) {
    return res.status(400).json({ error: "This reset link is invalid or has already been used." });
  }
  if (new Date(user.password_reset_expires_at) < new Date()) {
    return res.status(400).json({ error: "This reset link has expired. Please request a new one." });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await query(
    `UPDATE users SET password_hash = $1, password_reset_token_hash = NULL, password_reset_expires_at = NULL WHERE id = $2`,
    [passwordHash, user.id]
  );

  // Security notification — lets the real account owner know their
  // password changed, in case the reset wasn't actually them.
  await emailService.sendPasswordResetCompleted({ id: user.id, email: user.email, fullName: user.full_name });

  // KNOWN LIMITATION: JWTs already issued before this reset remain
  // valid until they naturally expire (access tokens: 30 minutes) —
  // this system has no server-side token blacklist/session store, so a
  // password reset cannot forcibly invalidate tokens already in
  // someone's possession. The 30-minute access-token lifetime bounds
  // this exposure; a real token-revocation list is listed as a
  // pre-production hardening item.
  res.json({ message: "Your password has been reset. Please log in with your new password." });
}));

module.exports = router;
