const express = require("express");
const { query }        = require("../config/db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (req, res) => {
  const { is_acked, customer_id, severity } = req.query;
  const conditions = [];
  const params = [];
  if (is_acked !== undefined) { params.push(is_acked === "true"); conditions.push(`is_acked = $${params.length}`); }
  if (customer_id) { params.push(customer_id); conditions.push(`customer_id = $${params.length}`); }
  if (severity)    { params.push(severity);    conditions.push(`severity = $${params.length}`);    }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT 100`, params);
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
