const express = require("express");
const { query }        = require("../config/db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ── GET /api/ad-users?customer_id=&search=&filter=&page=&limit= ──────
router.get("/", authenticate, async (req, res) => {
  try {
    const {
      customer_id, search = "", filter = "all",
      page = 1, limit = 100,
    } = req.query;

    const conditions = [];
    const params     = [];

    if (customer_id) {
      params.push(customer_id);
      conditions.push(`customer_id = $${params.length}`);
    }

    // Status filters
    if (filter === "disabled")         { conditions.push("is_enabled = false"); }
    if (filter === "enabled")          { conditions.push("is_enabled = true"); }
    if (filter === "admin")            { conditions.push("is_admin = true"); }
    if (filter === "pwd_never_expires"){ conditions.push("password_never_expires = true"); }
    if (filter === "pwd_expired")      { conditions.push("password_expired = true"); }
    if (filter === "pwd_not_required") { conditions.push("password_not_required = true"); }
    if (filter === "stale") {
      conditions.push("last_logon < NOW() - INTERVAL '90 days' OR last_logon IS NULL");
    }
    if (filter === "never_logged_in")  { conditions.push("last_logon IS NULL"); }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(sam_account_name) LIKE $${params.length}
          OR LOWER(display_name) LIKE $${params.length}
          OR LOWER(email) LIKE $${params.length}
          OR LOWER(department) LIKE $${params.length})`
      );
    }

    const where  = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (parseInt(page)-1) * parseInt(limit);

    const { rows: users } = await query(
      `SELECT * FROM ad_users ${where}
       ORDER BY is_admin DESC, is_enabled DESC, sam_account_name ASC
       LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, parseInt(limit), offset]
    );

    const { rows: countRow } = await query(
      `SELECT COUNT(*) FROM ad_users ${where}`, params
    );
    const total = parseInt(countRow[0].count);

    res.json({ users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ad-users/stats?customer_id= ─────────────────────────────
// Returns full posture stats for the AD user directory
router.get("/stats", authenticate, async (req, res) => {
  try {
    const { customer_id } = req.query;
    const whereClause = customer_id ? "WHERE customer_id = $1" : "";
    const params      = customer_id ? [customer_id] : [];

    const { rows: r } = await query(
      `SELECT
         COUNT(*)                                        AS total,
         COUNT(*) FILTER (WHERE is_enabled = true)      AS active,
         COUNT(*) FILTER (WHERE is_enabled = false)     AS disabled,
         COUNT(*) FILTER (WHERE is_admin = true)        AS admin_count,
         COUNT(*) FILTER (WHERE is_admin = true AND is_enabled = true) AS active_admins,
         COUNT(*) FILTER (WHERE password_never_expires = true) AS pwd_never_expires,
         COUNT(*) FILTER (WHERE password_expired = true)       AS pwd_expired,
         COUNT(*) FILTER (WHERE password_not_required = true)  AS pwd_not_required,
         COUNT(*) FILTER (WHERE last_logon IS NULL)             AS never_logged_in,
         COUNT(*) FILTER (WHERE last_logon < NOW() - INTERVAL '90 days') AS stale_90d,
         COUNT(*) FILTER (WHERE last_logon < NOW() - INTERVAL '180 days') AS stale_180d,
         COUNT(*) FILTER (WHERE pwd_last_set < NOW() - INTERVAL '90 days'
                           AND is_enabled = true)              AS pwd_age_90d,
         COUNT(*) FILTER (WHERE pwd_last_set < NOW() - INTERVAL '180 days'
                           AND is_enabled = true)              AS pwd_age_180d,
         COUNT(DISTINCT department) FILTER (WHERE department <> '') AS dept_count
       FROM ad_users ${whereClause}`,
      params
    );

    const stats = r[0];

    // Department breakdown (top 10) — clean condition building
    const deptConds = customer_id ? ["customer_id = $1", "department <> ''"] : ["department <> ''"];
    const { rows: depts } = await query(
      `SELECT department, COUNT(*) AS count
       FROM ad_users WHERE ${deptConds.join(" AND ")}
       GROUP BY department ORDER BY count DESC LIMIT 10`,
      params
    );

    // Admin group members — clean condition building
    const adminConds = customer_id ? ["customer_id = $1", "is_admin = true"] : ["is_admin = true"];
    const { rows: adminGroups } = await query(
      `SELECT member_of FROM ad_users WHERE ${adminConds.join(" AND ")}`,
      params
    );

    // Flatten and count group memberships
    const groupCounts = {};
    adminGroups.forEach(u => {
      (u.member_of || []).forEach(g => {
        const name = g.split(",")[0]?.replace("CN=","") || g;
        groupCounts[name] = (groupCounts[name] || 0) + 1;
      });
    });
    const topGroups = Object.entries(groupCounts)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Last scan time
    const { rows: scanRow } = await query(
      `SELECT MAX(scanned_at) AS last_scan FROM ad_users ${whereClause}`, params
    );

    res.json({
      ...Object.fromEntries(Object.entries(stats).map(([k,v]) => [k, parseInt(v)||0])),
      departments: depts.map(d => ({ name: d.department, count: parseInt(d.count) })),
      top_groups:  topGroups,
      last_scan:   scanRow[0]?.last_scan || null,
      no_data:     parseInt(stats.total) === 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/ad-users/platform-stats ─────────────────────────────────
// Cross-customer aggregated stats
router.get("/platform-stats", authenticate, async (req, res) => {
  try {
    const { rows: r } = await query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE is_enabled = true)      AS active,
        COUNT(*) FILTER (WHERE is_enabled = false)     AS disabled,
        COUNT(*) FILTER (WHERE is_admin = true)        AS admin_count,
        COUNT(*) FILTER (WHERE password_never_expires = true) AS pwd_never_expires,
        COUNT(*) FILTER (WHERE password_expired = true)       AS pwd_expired,
        COUNT(*) FILTER (WHERE password_not_required = true)  AS pwd_not_required,
        COUNT(*) FILTER (WHERE last_logon IS NULL)             AS never_logged_in,
        COUNT(*) FILTER (WHERE last_logon < NOW() - INTERVAL '90 days') AS stale_90d
      FROM ad_users
    `);

    const { rows: perDomain } = await query(`
      SELECT customer_name,
             COUNT(*)                                        AS total,
             COUNT(*) FILTER (WHERE is_enabled = true)      AS active,
             COUNT(*) FILTER (WHERE is_enabled = false)     AS disabled,
             COUNT(*) FILTER (WHERE is_admin = true)        AS admin_count,
             COUNT(*) FILTER (WHERE password_never_expires = true) AS pwd_never_expires,
             COUNT(*) FILTER (WHERE password_expired = true)       AS pwd_expired,
             COUNT(*) FILTER (WHERE last_logon IS NULL)             AS never_logged_in
      FROM ad_users
      GROUP BY customer_name
      ORDER BY total DESC
    `);

    res.json({
      ...Object.fromEntries(Object.entries(r[0]).map(([k,v]) => [k, parseInt(v)||0])),
      no_data:    parseInt(r[0].total) === 0,
      per_domain: perDomain.map(d =>
        Object.fromEntries(Object.entries(d).map(([k,v]) => [k, isNaN(parseInt(v)) ? v : parseInt(v)]))
      ),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
