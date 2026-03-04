const express = require("express");
const { query }        = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const router = express.Router();

// Defaults returned when nothing is saved yet
const DEFAULTS = {
  portal_title:       "ADSentinel",
  portal_subtitle:    "Enterprise Active Directory Security",
  primary_color:      "#0ea5e9",
  logo_url:           "",
  alert_email:        "",
  slack_webhook:      "",
  scan_interval_hours:"6",
  retention_days:     "365",
};

router.get("/", authenticate, async (req, res) => {
  try {
    const { rows } = await query("SELECT key, value FROM app_settings");
    const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
    // Merge defaults with saved so frontend always gets complete object
    res.json({ ...DEFAULTS, ...saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    if (!entries.length) return res.status(400).json({ error: "No settings provided" });

    for (const [key, value] of entries) {
      await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value === null || value === undefined ? "" : String(value)]
      );
    }
    // Return full merged settings after save
    const { rows } = await query("SELECT key, value FROM app_settings");
    const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ message: "Settings saved", settings: { ...DEFAULTS, ...saved } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
