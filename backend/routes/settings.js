const express = require("express");

const { query } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

// Central contract so adding new settings stays easy and safe.
const SETTINGS_SCHEMA = {
  portal_title:        { type: "string", max: 120, default: "ADSentinel" },
  portal_subtitle:     { type: "string", max: 240, default: "Enterprise Active Directory Security" },
  primary_color:       { type: "color", default: "#22c55e" },
  logo_url:            { type: "string", max: 500, default: "" },
  alert_email:         { type: "email", default: "" },
  slack_webhook:       { type: "url", default: "" },
  webhook_url:         { type: "url", default: "" },
  pagerduty_routing_key:{ type: "string", max: 255, default: "" },
  notifications:       { type: "json", default: "" },
  audit_params:        { type: "json", default: "" },
  scan_interval_hours: { type: "int", min: 1, max: 168, default: "6" },
  retention_days:      { type: "int", min: 7, max: 3650, default: "365" },
  default_domain:      { type: "domain", default: "" },
};

const DEFAULTS = Object.fromEntries(
  Object.entries(SETTINGS_SCHEMA).map(([key, config]) => [key, String(config.default)])
);

function validateSetting(key, value) {
  const schema = SETTINGS_SCHEMA[key];
  if (!schema) return `Unsupported setting: ${key}`;

  const str = value === null || value === undefined ? "" : String(value).trim();

  if (schema.type === "string") {
    if (schema.max && str.length > schema.max) return `${key} exceeds max length (${schema.max})`;
    return null;
  }

  if (schema.type === "int") {
    if (!/^\d+$/.test(str)) return `${key} must be a positive integer`;
    const n = parseInt(str, 10);
    if (schema.min !== undefined && n < schema.min) return `${key} must be >= ${schema.min}`;
    if (schema.max !== undefined && n > schema.max) return `${key} must be <= ${schema.max}`;
    return null;
  }

  if (schema.type === "email") {
    if (!str) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) return `${key} must be a valid email`;
    return null;
  }

  if (schema.type === "url") {
    if (!str) return null;
    if (!/^https?:\/\//i.test(str)) return `${key} must start with http:// or https://`;
    return null;
  }

  if (schema.type === "color") {
    if (!/^#([A-Fa-f0-9]{6})$/.test(str)) return `${key} must be a 6-digit hex color (e.g. #22c55e)`;
    return null;
  }

  if (schema.type === "json") {
    if (!str) return null;
    try { JSON.parse(str); return null; } catch { return `${key} must be valid JSON`; }
  }

  if (schema.type === "domain") {
    if (!str) return null;
    if (!/^(?=.{3,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(str)) {
      return `${key} must be a valid FQDN (e.g. corp.example.com)`;
    }
    return null;
  }

  return `Unsupported validator for ${key}`;
}

router.get("/", authenticate, async (req, res) => {
  try {
    const { rows } = await query("SELECT key, value FROM app_settings");
    const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ ...DEFAULTS, ...saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lightweight schema endpoint to support dynamic setting forms/importers.
router.get("/schema", authenticate, requireRole("admin"), (req, res) => {
  res.json({ schema: SETTINGS_SCHEMA, defaults: DEFAULTS });
});

router.put("/", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const entries = Object.entries(req.body || {});
    if (!entries.length) return res.status(400).json({ error: "No settings provided" });

    const errors = [];
    for (const [key, value] of entries) {
      const err = validateSetting(key, value);
      if (err) errors.push(err);
    }
    if (errors.length) return res.status(400).json({ error: "Invalid settings", details: errors });

    for (const [key, value] of entries) {
      await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value === null || value === undefined ? "" : String(value).trim()]
      );
    }

    const { rows } = await query("SELECT key, value FROM app_settings");
    const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ message: "Settings saved", settings: { ...DEFAULTS, ...saved } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
