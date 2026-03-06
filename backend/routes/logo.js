const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { authenticate, requireRole } = require("../middleware/auth");
const { query } = require("../config/db");

const router  = express.Router();
const LOGO_DIR = path.join(__dirname, "../uploads/logos");
if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGO_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── POST /api/logo ─────────────────────────────────────────────────
router.post("/", authenticate, requireRole("admin"), upload.single("logo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded or invalid format" });

  const logoUrl = `/uploads/logos/${req.file.filename}`;

  // Remove old logo file
  const { rows } = await query("SELECT value FROM app_settings WHERE key = 'logo_url'");
  if (rows[0]?.value) {
    const oldPath = path.join(__dirname, "..", String(rows[0].value || "").replace(/^\//, ""));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('logo_url', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [logoUrl]
  );
  res.json({ logoUrl });
});

// ── DELETE /api/logo ───────────────────────────────────────────────
router.delete("/", authenticate, requireRole("admin"), async (req, res) => {
  const { rows } = await query("SELECT value FROM app_settings WHERE key = 'logo_url'");
  if (rows[0]?.value) {
    const filePath = path.join(__dirname, "..", String(rows[0].value || "").replace(/^\//, ""));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await query("DELETE FROM app_settings WHERE key = 'logo_url'");
  res.json({ message: "Logo removed" });
});

module.exports = router;
