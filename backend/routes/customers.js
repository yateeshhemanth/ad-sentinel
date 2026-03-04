const express = require("express");
const { query }        = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const { encrypt, decrypt } = require("../config/crypto");
const router = express.Router();

// ── GET /api/customers ───────────────────────────────────────────────
// Never return bind_password_enc to the client
router.get("/", authenticate, async (req, res) => {
  const { rows } = await query("SELECT * FROM customers WHERE is_active = true ORDER BY name");
  res.json(rows.map(({ bind_password_enc, ...safe }) => safe));
});

// ── POST /api/customers ──────────────────────────────────────────────
router.post("/", authenticate, requireRole("admin", "engineer"), async (req, res) => {
  try {
    const {
      name, domain, dc_ip, ldap_port,
      bind_dn, bind_password, bind_password_enc,
      hr_status_url, hr_status_token,
    } = req.body;

    if (!name || !domain) return res.status(400).json({ error: "name and domain are required" });

    // Encrypt bind password before storing — never keep AD credentials in plaintext
    const rawPassword    = bind_password_enc || bind_password || null;
    const storedPassword = rawPassword ? encrypt(rawPassword) : null;

    const { rows } = await query(
      `INSERT INTO customers (name, domain, dc_ip, ldap_port, bind_dn, bind_password_enc, hr_status_url, hr_status_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, domain, dc_ip || null, parseInt(ldap_port) || 389, bind_dn || null, storedPassword,
       hr_status_url || null, hr_status_token || null]
    );
    // Never expose the encrypted password to the client
    const { bind_password_enc: _enc, ...safe } = rows[0];
    res.status(201).json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/customers/:id ─────────────────────────────────────────
router.patch("/:id", authenticate, requireRole("admin", "engineer"), async (req, res) => {
  try {
    const {
      name, domain, dc_ip, ldap_port,
      bind_dn, bind_password, bind_password_enc,
      hr_status_url, hr_status_token,
    } = req.body;

    const fields = [], params = [];
    const set = (col, val) => {
      if (val !== undefined) { params.push(val); fields.push(`${col} = $${params.length}`); }
    };

    set("name",             name);
    set("domain",           domain);
    set("dc_ip",            dc_ip);
    set("ldap_port",        ldap_port !== undefined ? parseInt(ldap_port)||389 : undefined);
    set("bind_dn",          bind_dn);

    // Encrypt the incoming password if one was supplied
    const rawPwd = bind_password_enc !== undefined ? bind_password_enc
                 : bind_password     !== undefined ? bind_password
                 : undefined;
    if (rawPwd !== undefined) {
      set("bind_password_enc", rawPwd ? encrypt(rawPwd) : null);
    }

    set("hr_status_url",    hr_status_url);
    set("hr_status_token",  hr_status_token);

    if (!fields.length) return res.status(400).json({ error: "No fields to update" });

    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE customers SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: "Customer not found" });
    // Never expose the encrypted password to the client
    const { bind_password_enc: _enc2, ...safe2 } = rows[0];
    res.json(safe2);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/customers/:id ────────────────────────────────────────
router.delete("/:id", authenticate, requireRole("admin"), async (req, res) => {
  await query("UPDATE customers SET is_active = false WHERE id = $1", [req.params.id]);
  res.json({ message: "Customer deactivated" });
});

// ── GET /api/customers/platform-posture ─────────────────────────────
// Must be BEFORE /:id routes
router.get("/platform-posture", authenticate, async (req, res) => {
  try {
    const { rows: alerts } = await query(
      "SELECT customer_id, customer_name, severity, details FROM alerts WHERE is_acked=false"
    );
    const findings = alerts.filter(a => a.details?.finding_id);

    const custMap = {};
    alerts.forEach(a => {
      if (!custMap[a.customer_id]) custMap[a.customer_id] = { name:a.customer_name, critical:0, high:0, medium:0, low:0, total:0 };
      custMap[a.customer_id][a.severity] = (custMap[a.customer_id][a.severity]||0) + 1;
      custMap[a.customer_id].total++;
    });

    const userMap = {};
    const SEV_ORDER = { critical:0, high:1, medium:2, low:3 };
    findings.forEach(a => {
      (a.details.affected_users||[]).forEach(u => {
        if (!userMap[u]) userMap[u] = { username:u, findings:[], worst:"low", customers:new Set() };
        userMap[u].findings.push(a.details.finding_id);
        userMap[u].customers.add(a.customer_name);
        if ((SEV_ORDER[a.severity]||3) < (SEV_ORDER[userMap[u].worst]||3))
          userMap[u].worst = a.severity;
      });
    });

    const users = Object.values(userMap)
      .map(u => ({ ...u, customers:[...u.customers] }))
      .sort((a,b) => (SEV_ORDER[a.worst]||3)-(SEV_ORDER[b.worst]||3));

    const byCategory = {};
    findings.forEach(a => {
      const cat = a.details.category||"other";
      byCategory[cat] = (byCategory[cat]||0)+(a.details.affected_count||0);
    });

    const findingStats = {};
    findings.forEach(a => {
      const fid = a.details.finding_id;
      if (!findingStats[fid]) findingStats[fid] = { finding_id:fid, severity:a.severity, affected:0, customers:0 };
      findingStats[fid].affected += (a.details.affected_count||0);
      findingStats[fid].customers++;
    });

    const totalCrit = alerts.filter(a=>a.severity==="critical").length;
    const totalHigh = alerts.filter(a=>a.severity==="high").length;
    const totalMed  = alerts.filter(a=>a.severity==="medium").length;

    const statFn = (fid) => alerts.filter(a=>a.details?.finding_id===fid).reduce((s,a)=>s+(a.details?.affected_count||0),0);

    res.json({
      users,
      total_affected: users.length,
      critical_users: users.filter(u=>u.worst==="critical").length,
      high_users:     users.filter(u=>u.worst==="high").length,
      byCategory,
      topFindings: Object.values(findingStats).sort((a,b)=>b.affected-a.affected).slice(0,10),
      perCustomer: Object.values(custMap),
      stats: {
        total_alerts: alerts.length,
        critical:totalCrit, high:totalHigh, medium:totalMed,
        score: Math.max(0,Math.min(100,100-totalCrit*12-totalHigh*4-totalMed*1)),
        blank_passwords: statFn("AD-PWD-002"),
        no_expiry:       statFn("AD-PWD-001"),
        stale_accounts:  statFn("AD-ACCT-001"),
        priv_anomalies:  statFn("AD-PRIV-001"),
        kerberoastable:  statFn("AD-PRIV-002"),
        asrep_roastable: statFn("AD-PRIV-003"),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/customers/:id/posture ───────────────────────────────────
router.get("/:id/posture", authenticate, async (req, res) => {
  try {
    const { rows: alerts } = await query(
      "SELECT severity, details FROM alerts WHERE customer_id=$1 AND is_acked=false",
      [req.params.id]
    );
    const findings = alerts.filter(a => a.details?.finding_id);

    const userMap = {};
    const SEV_ORDER = { critical:0, high:1, medium:2, low:3 };
    findings.forEach(a => {
      (a.details.affected_users||[]).forEach(u => {
        if (!userMap[u]) userMap[u] = { username:u, findings:[], worst:"low" };
        userMap[u].findings.push(a.details.finding_id);
        if ((SEV_ORDER[a.severity]||3) < (SEV_ORDER[userMap[u].worst]||3))
          userMap[u].worst = a.severity;
      });
    });

    const users = Object.values(userMap).sort((a,b) => (SEV_ORDER[a.worst]||3)-(SEV_ORDER[b.worst]||3));
    const byCategory = {};
    findings.forEach(a => {
      const cat = a.details.category||"other";
      byCategory[cat] = (byCategory[cat]||0)+(a.details.affected_count||0);
    });

    res.json({
      users,
      total_affected:   users.length,
      critical_users:   users.filter(u=>u.worst==="critical").length,
      high_users:       users.filter(u=>u.worst==="high").length,
      byCategory,
      password_issues:  findings.filter(a=>a.details.category==="password").reduce((s,a)=>s+(a.details.affected_count||0),0),
      privilege_issues: findings.filter(a=>a.details.category==="privilege").reduce((s,a)=>s+(a.details.affected_count||0),0),
      findings_summary: findings.map(a=>({ finding_id:a.details.finding_id, severity:a.severity, affected:a.details.affected_count||0, users:a.details.affected_users||[] })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
