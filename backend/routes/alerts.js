const express = require("express");
const { query }        = require("../config/db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();


async function getAutomationUserId() {
  const { rows } = await query(
    `SELECT id FROM users WHERE is_active = true ORDER BY CASE WHEN role='admin' THEN 0 WHEN role='engineer' THEN 1 ELSE 2 END, created_at ASC LIMIT 1`
  );
  return rows[0]?.id || null;
}

async function ensureTicketForAlert(alertRow) {
  if (!alertRow?.id) return;
  const details = alertRow.details || {};
  if (!details.finding_id) return;

  const { rows: existing } = await query(
    "SELECT id FROM tickets WHERE alert_id = $1 AND status IN ('open','in_progress') LIMIT 1",
    [alertRow.id]
  );
  if (existing.length) return;

  const createdBy = await getAutomationUserId();
  if (!createdBy) return;

  const { rows: seqRows } = await query("SELECT COUNT(*) FROM tickets WHERE created_at::date = CURRENT_DATE");
  const seq = String(parseInt(seqRows[0].count, 10) + 1).padStart(4, "0");
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const ticketNo = `TKT-${dateStr}-${seq}`;

  const severity = String(alertRow.severity || "medium").toLowerCase();
  const priority = ["critical", "high", "medium", "low"].includes(severity) ? severity : "medium";
  const tags = [details.finding_id, details.category, severity].filter(Boolean);
  const users = Array.isArray(details.affected_users) ? details.affected_users.filter(Boolean) : [];
  const description = [
    `Auto-created from alert ${alertRow.id}.`,
    `Tags: ${tags.map(t => `#${String(t).replace(/[^a-z0-9_-]/ig, "_")}`).join(" ")}`,
    users.length ? `Affected users: ${users.join(", ")}` : "",
    details.remediation ? `Remediation: ${details.remediation}` : "",
  ].filter(Boolean).join("\n");

  await query(
    `INSERT INTO tickets (ticket_no, title, description, priority, customer_id, customer_name, alert_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      ticketNo,
      `[${details.finding_id}] ${alertRow.message}`,
      description,
      priority,
      alertRow.customer_id || null,
      alertRow.customer_name || null,
      alertRow.id,
      createdBy,
    ]
  );
}


router.get("/", authenticate, async (req, res) => {
  const { is_acked, customer_id, severity } = req.query;
  const conditions = [];
  const params = [];
  if (is_acked !== undefined) { params.push(is_acked === "true"); conditions.push(`is_acked = $${params.length}`); }
  if (customer_id) { params.push(customer_id); conditions.push(`customer_id = $${params.length}`); }
  if (severity)    { params.push(severity);    conditions.push(`severity = $${params.length}`);    }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT 100`, params);
  for (const row of rows) {
    await ensureTicketForAlert(row).catch(() => {});
  }
  res.json(rows);
});

router.patch("/:id/ack", authenticate, async (req, res) => {
  const { rows } = await query(
    "UPDATE alerts SET is_acked = true, acked_by = $1, acked_at = NOW() WHERE id = $2 RETURNING *",
    [req.user.id, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Alert not found" });
  res.json(rows[0]);
});

router.patch("/ack-all", authenticate, async (req, res) => {
  const { customer_id } = req.body;
  const conditions = ["is_acked = false"];
  const params = [req.user.id];
  if (customer_id) { params.push(customer_id); conditions.push(`customer_id = $${params.length}`); }
  await query(
    `UPDATE alerts SET is_acked = true, acked_by = $1, acked_at = NOW() WHERE ${conditions.join(" AND ")}`,
    params
  );
  res.json({ message: "All alerts acknowledged" });
});

module.exports = router;
