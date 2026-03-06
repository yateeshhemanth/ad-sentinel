const express = require("express");
const { query } = require("../config/db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get("/snapshots", authenticate, async (req, res) => {
  const { customer_id, limit = 50 } = req.query;
  const params = [];
  const where = [];
  if (customer_id) { params.push(customer_id); where.push(`customer_id = $${params.length}`); }
  params.push(Math.min(parseInt(limit, 10) || 50, 200));
  const { rows } = await query(
    `SELECT * FROM ad_inventory_snapshots ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY started_at DESC LIMIT $${params.length}`,
    params
  );
  res.json(rows);
});

router.get("/objects", authenticate, async (req, res) => {
  const { snapshot_id, object_type, customer_id, limit = 500 } = req.query;
  const params = [];
  const where = [];
  if (snapshot_id) { params.push(snapshot_id); where.push(`snapshot_id = $${params.length}`); }
  if (object_type) { params.push(object_type); where.push(`object_type = $${params.length}`); }
  if (customer_id) { params.push(customer_id); where.push(`customer_id = $${params.length}`); }
  params.push(Math.min(parseInt(limit, 10) || 500, 2000));

  const { rows } = await query(
    `SELECT id, snapshot_id, customer_id, customer_name, object_type, object_key, distinguished_name, attributes, scanned_at
       FROM ad_inventory_objects
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY scanned_at DESC
      LIMIT $${params.length}`,
    params
  );
  res.json(rows);
});

module.exports = router;
