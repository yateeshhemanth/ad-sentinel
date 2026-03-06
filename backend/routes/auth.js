const express    = require("express");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const crypto     = require("crypto");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
const { body, validationResult } = require("express-validator");
const rateLimit  = require("express-rate-limit");

const { query }        = require("../config/db");
const { getClient }    = require("../config/redis");
const { authenticate } = require("../middleware/auth");
const logger           = require("../config/logger");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: "Too many requests, try again later" },
});

// ── POST /api/auth/login ───────────────────────────────────────────
router.post("/login", authLimiter, [
  body("email").isEmail().trim().toLowerCase(),  // normalise without express-validator's normalizeEmail
  body("password").isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  // Ensure consistent case — trim + lowercase before DB lookup
  const normalizedEmail = email.trim().toLowerCase();
  try {
    const { rows } = await query(
      "SELECT id, email, name, role, password_hash, is_active FROM users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );
    const user = rows[0];
    if (!user) {
      logger.warn(`Login failed — user not found: ${normalizedEmail}`);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (!user.is_active) {
      logger.warn(`Login failed — inactive user: ${normalizedEmail}`);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logger.warn(`Login failed — wrong password: ${normalizedEmail}`);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    await query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, jti: uuidv4() },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    logger.info(`Login: ${email}`);
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    logger.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT key, value FROM app_settings WHERE key IN ('logo_url','portal_title','portal_subtitle','primary_color')"
    );
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({
      ...req.user,
      logoUrl:       s.logo_url       || null,
      portalTitle:   s.portal_title   || "ADSentinel",
      portalSubtitle:s.portal_subtitle|| "Enterprise Active Directory Security",
      primaryColor:  s.primary_color  || "#22c55e",
    });
  } catch (err) {
    logger.error("GET /me error:", err);
    res.status(500).json({ error: "Failed to load user profile" });
  }
});

// ── GET /api/auth/verify (used by nginx auth_request) ─────────────
router.get("/verify", authenticate, (req, res) => res.sendStatus(200));

// ── POST /api/auth/logout ──────────────────────────────────────────
router.post("/logout", authenticate, async (req, res) => {
  // Blacklist the current token in Redis so it cannot be reused
  const redisClient = getClient();
  if (redisClient && req.token) {
    const blKey = `jwt:bl:${req.token.userId}:${req.token.iat}`;
    // TTL = remaining seconds until the token would have expired anyway
    const ttl = Math.max((req.token.exp || 0) - Math.floor(Date.now() / 1000), 1);
    await redisClient.set(blKey, "1", "EX", ttl).catch(() => {});
  }
  logger.info(`Logout: ${req.user.email}`);
  res.json({ message: "Logged out successfully" });
});

// ── POST /api/auth/forgot-password ────────────────────────────────
router.post("/forgot-password", authLimiter, [
  body("email").isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  // Always return 200 to avoid email enumeration
  res.json({ message: "If that email exists, a reset link has been sent." });

  const { email } = req.body;
  try {
    const { rows } = await query("SELECT id FROM users WHERE email = $1", [email]);
    if (!rows.length) return;

    const token   = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3",
      [token, expires, email]
    );

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await sendResetEmail(email, resetUrl);
    logger.info(`Password reset sent to ${email}`);
  } catch (err) {
    logger.error("Forgot password error:", err);
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────────
router.post("/reset-password", [
  body("token").notEmpty(),
  body("password").isLength({ min: 8 })
    .matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { token, password } = req.body;
  try {
    const { rows } = await query(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: "Invalid or expired reset token" });

    const hash = await bcrypt.hash(password, 12);
    await query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2",
      [hash, rows[0].id]
    );
    logger.info(`Password reset for user ${rows[0].id}`);
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    logger.error("Reset password error:", err);
    res.status(500).json({ error: "Reset failed" });
  }
});

// ── POST /api/auth/change-password (authenticated) ────────────────
router.post("/change-password", authenticate, [
  body("currentPassword").notEmpty(),
  body("newPassword")
    .isLength({ min: 8 })
    .matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/)
    .withMessage("New password must include uppercase, number, and special character")
    .custom((value, { req }) => value !== req.body.currentPassword)
    .withMessage("New password must differ from current password"),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { currentPassword, newPassword } = req.body;

  try {
    const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 12);
    await query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);
    res.json({ message: "Password changed successfully" });
  } catch (err) {
    logger.error("Change password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// ── Helpers ────────────────────────────────────────────────────────
async function sendResetEmail(to, resetUrl) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "ADSentinel — Password Reset Request",
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto">
        <h2 style="color:#22c55e">ADSentinel Password Reset</h2>
        <p>You requested a password reset. Click below within 1 hour:</p>
        <a href="${resetUrl}" style="display:inline-block;background:#22c55e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Reset Password</a>
        <p style="color:#888;font-size:12px;margin-top:24px">If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

module.exports = router;
