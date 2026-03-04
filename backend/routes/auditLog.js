const express = require("express");
const { query } = require("../config/db");
const { authenticate } = require("../middleware/auth");
const router = express.Router();

// GET /api/audit-log
router.get("/", authenticate, async (req, res) => {
  try {
    const { customer_id, severity, limit = 100 } = req.query;
    const conditions = [];
    const params = [];

    if (customer_id) { params.push(customer_id); conditions.push(`customer_id = $${params.length}`); }
    if (severity)    { params.push(severity);     conditions.push(`severity = $${params.length}`);    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1}`,
      [...params, parseInt(limit)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
