const express = require("express");
const { body, validationResult } = require("express-validator");
const { query }        = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const logger           = require("../config/logger");

const router = express.Router();

// ── GET /api/tickets ───────────────────────────────────────────────
router.get("/", authenticate, async (req, res) => {
  const { status, priority, customer_id, page = 1, limit = 25 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (status)      { params.push(status);      conditions.push(`t.status = $${params.length}`); }
  if (priority)    { params.push(priority);     conditions.push(`t.priority = $${params.length}`); }
  if (customer_id) { params.push(customer_id);  conditions.push(`t.customer_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);

  const { rows } = await query(`
    SELECT t.*, u.name AS assignee_name, c.name AS creator_name
    FROM tickets t
    LEFT JOIN users u ON t.assignee_id = u.id
    LEFT JOIN users c ON t.created_by  = c.id
    ${where}
    ORDER BY t.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const { rows: total } = await query(
    `SELECT COUNT(*) FROM tickets t ${where}`,
    params.slice(0, -2)
  );

  res.json({ tickets: rows, total: parseInt(total[0].count), page: parseInt(page), limit: parseInt(limit) });
});

// ── GET /api/tickets/:id ───────────────────────────────────────────
router.get("/:id", authenticate, async (req, res) => {
  const { rows } = await query(`
    SELECT t.*, u.name AS assignee_name
    FROM tickets t
    LEFT JOIN users u ON t.assignee_id = u.id
    WHERE t.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Ticket not found" });

  const { rows: comments } = await query(
    "SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC",
    [req.params.id]
  );
  res.json({ ...rows[0], comments });
});

// ── POST /api/tickets ──────────────────────────────────────────────
router.post("/", authenticate, [
  body("title").notEmpty().isLength({ max: 500 }),
  body("priority").isIn(["low", "medium", "high", "critical"]),
  body("customer_id").optional().isUUID(),
  body("alert_id").optional().isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, description, priority, customer_id, customer_name, alert_id, assignee_id } = req.body;

  // Generate ticket number: TKT-YYYYMMDD-XXXX
  const { rows: seqRows } = await query("SELECT COUNT(*) FROM tickets WHERE created_at::date = CURRENT_DATE");
  const seq = String(parseInt(seqRows[0].count) + 1).padStart(4, "0");
  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,"");
  const ticket_no = `TKT-${dateStr}-${seq}`;

  const { rows } = await query(`
    INSERT INTO tickets (ticket_no, title, description, priority, customer_id, customer_name, alert_id, assignee_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
  `, [ticket_no, title, description, priority, customer_id, customer_name, alert_id, assignee_id, req.user.id]);

  // Auto-ack the linked alert
  if (alert_id) {
    await query("UPDATE alerts SET is_acked = true, acked_by = $1, acked_at = NOW() WHERE id = $2", [req.user.id, alert_id]);
  }

  // Audit log
  await query(
    `INSERT INTO audit_log (user_id, user_email, customer_id, customer_name, action, details)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.user.id, req.user.email, customer_id, customer_name, "TICKET_CREATED",
     JSON.stringify({ ticket_no, title, priority })]
  );

  logger.info(`Ticket ${ticket_no} created by ${req.user.email}`);
  res.status(201).json(rows[0]);
});

// ── PATCH /api/tickets/:id ─────────────────────────────────────────
router.patch("/:id", authenticate, async (req, res) => {
  const allowed = ["title", "description", "priority", "status", "assignee_id"];
  const updates = [];
  const params  = [];

  allowed.forEach(field => {
    if (req.body[field] !== undefined) {
      params.push(req.body[field]);
      updates.push(`${field} = $${params.length}`);
    }
  });
  if (!updates.length) return res.status(400).json({ error: "No valid fields to update" });

  if (req.body.status === "closed") {
    updates.push(`closed_at = NOW()`);
  }
  params.push(new Date(), req.params.id);
  updates.push(`updated_at = $${params.length - 1}`);

  const { rows } = await query(
    `UPDATE tickets SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: "Ticket not found" });
  res.json(rows[0]);
});

// ── POST /api/tickets/:id/comments ────────────────────────────────
router.post("/:id/comments", authenticate, [
  body("comment").notEmpty().isLength({ max: 2000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { rows } = await query(`
    INSERT INTO ticket_comments (ticket_id, user_id, user_name, comment)
    VALUES ($1,$2,$3,$4) RETURNING *
  `, [req.params.id, req.user.id, req.user.name, req.body.comment]);

  await query("UPDATE tickets SET updated_at = NOW() WHERE id = $1", [req.params.id]);
  res.status(201).json(rows[0]);
});

// ── DELETE /api/tickets/:id ────────────────────────────────────────
router.delete("/:id", authenticate, requireRole("admin"), async (req, res) => {
  await query("DELETE FROM tickets WHERE id = $1", [req.params.id]);
  res.json({ message: "Ticket deleted" });
});

module.exports = router;
