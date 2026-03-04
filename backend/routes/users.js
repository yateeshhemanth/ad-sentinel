const express = require("express");
const bcrypt  = require("bcryptjs");
const { query } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const router = express.Router();

// GET /api/users
router.get("/", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, email, name, role, is_active, last_login, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users
router.post("/", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const { email, name, role, password } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: "email, name and password required" });

    // Only engineer and analyst can be created here — admin is superadmin-only
    const allowed = ["engineer", "analyst"];
    if (!allowed.includes(role)) return res.status(403).json({ error: "Invalid role. Only engineer or analyst allowed." });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, is_active, created_at`,
      [email.toLowerCase().trim(), name, hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Email already exists" });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id — toggle active
router.patch("/:id", authenticate, requireRole("admin"), async (req, res) => {
  try {
    const { is_active } = req.body;
    const { rows } = await query(
      `UPDATE users SET is_active=$1, updated_at=NOW() WHERE id=$2
       RETURNING id, email, name, role, is_active`,
      [is_active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id
router.delete("/:id", authenticate, requireRole("admin"), async (req, res) => {
  try {
    // Prevent deleting yourself
    if (req.params.id === req.user.id) return res.status(400).json({ error: "Cannot delete your own account" });
    await query("UPDATE users SET is_active=false WHERE id=$1", [req.params.id]);
    res.json({ message: "User deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
