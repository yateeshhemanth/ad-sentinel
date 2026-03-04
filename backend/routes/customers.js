const express = require("express");
const { body, param, validationResult } = require("express-validator");

const { query } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const { encrypt } = require("../config/crypto");

const router = express.Router();

const customerValidators = [
  body("name").optional().isString().trim().isLength({ min: 2, max: 255 }),
  body("domain")
    .optional()
    .isString()
    .trim()
    .toLowerCase()
    .matches(/^(?=.{3,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  body("dc_ip").optional({ nullable: true }).isString().trim().isLength({ min: 0, max: 255 }),
  body("ldap_port").optional({ nullable: true }).isInt({ min: 1, max: 65535 }),
  body("bind_dn").optional({ nullable: true }).isString().trim().isLength({ min: 0, max: 1024 }),
  body("bind_password").optional({ nullable: true }).isString().isLength({ min: 0, max: 2048 }),
  body("bind_password_enc").optional({ nullable: true }).isString().isLength({ min: 0, max: 2048 }),
  body("hr_status_url").optional({ nullable: true }).custom((value) => {
    if (value === "" || value === null || value === undefined) return true;
    return /^https?:\/\//i.test(value);
  }),
  body("hr_status_token").optional({ nullable: true }).isString().isLength({ min: 0, max: 2048 }),
];

const requiredCreateValidators = [
  body("name").exists().withMessage("name is required"),
  body("domain").exists().withMessage("domain is required"),
];

const idValidator = [param("id").isUUID()];

function validateOr400(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  res.status(400).json({ errors: errors.array() });
  return true;
}

function toSafeCustomer(row) {
  const { bind_password_enc, ...safe } = row;
  return safe;
}

function normalizeCustomerPayload(body = {}) {
  const normalized = {
    name: body.name?.trim(),
    domain: body.domain?.trim().toLowerCase(),
    dc_ip: body.dc_ip?.trim() || null,
    ldap_port: body.ldap_port !== undefined ? parseInt(body.ldap_port, 10) : undefined,
    bind_dn: body.bind_dn?.trim() || null,
    hr_status_url: body.hr_status_url?.trim() || null,
    hr_status_token: body.hr_status_token?.trim() || null,
  };

  const rawPassword = body.bind_password_enc !== undefined
    ? body.bind_password_enc
    : body.bind_password;
  if (rawPassword !== undefined) {
    normalized.bind_password_enc = rawPassword ? encrypt(rawPassword) : null;
  }

  return normalized;
}

// ── GET /api/customers ───────────────────────────────────────────────
router.get("/", authenticate, async (req, res) => {
  try {
    const { rows } = await query("SELECT * FROM customers WHERE is_active = true ORDER BY name");
    res.json(rows.map(toSafeCustomer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/customers/template ──────────────────────────────────────
// Gives the frontend/importers a contract for easy domain onboarding.
router.get("/template", authenticate, requireRole("admin", "engineer"), (req, res) => {
  res.json({
    fields: [
      { key: "name", required: true, example: "HQ Forest" },
      { key: "domain", required: true, example: "corp.example.com" },
      { key: "dc_ip", required: false, example: "10.0.10.15" },
      { key: "ldap_port", required: false, default: 389 },
      { key: "bind_dn", required: false, example: "CN=svc_ldap,OU=Service Accounts,DC=corp,DC=example,DC=com" },
      { key: "bind_password", required: false, writeOnly: true },
      { key: "hr_status_url", required: false, example: "https://hr.example.com/api/status" },
      { key: "hr_status_token", required: false, writeOnly: true },
    ],
  });
});

// ── POST /api/customers ──────────────────────────────────────────────
router.post("/", authenticate, requireRole("admin", "engineer"), [...customerValidators, ...requiredCreateValidators], async (req, res) => {
  if (validateOr400(req, res)) return;

  try {
    const payload = normalizeCustomerPayload(req.body);

    const { rows } = await query(
      `INSERT INTO customers (name, domain, dc_ip, ldap_port, bind_dn, bind_password_enc, hr_status_url, hr_status_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        payload.name,
        payload.domain,
        payload.dc_ip,
        payload.ldap_port || 389,
        payload.bind_dn,
        payload.bind_password_enc || null,
        payload.hr_status_url,
        payload.hr_status_token,
      ]
    );

    res.status(201).json(toSafeCustomer(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/customers/bulk ─────────────────────────────────────────
// Upsert many domain configs in one call to simplify production onboarding.
router.post(
  "/bulk",
  authenticate,
  requireRole("admin", "engineer"),
  body("customers").isArray({ min: 1, max: 200 }),
  async (req, res) => {
    if (validateOr400(req, res)) return;

    const created = [];
    const updated = [];
    const errors = [];

    for (let i = 0; i < req.body.customers.length; i++) {
      const raw = req.body.customers[i] || {};
      try {
        const payload = normalizeCustomerPayload(raw);
        if (!payload.name || !payload.domain) {
          errors.push({ index: i, error: "name and domain are required" });
          continue;
        }

        const { rows: existing } = await query(
          "SELECT id FROM customers WHERE LOWER(domain) = $1 LIMIT 1",
          [payload.domain]
        );

        if (existing.length) {
          const { rows } = await query(
            `UPDATE customers
                SET name=$1, dc_ip=$2, ldap_port=$3, bind_dn=$4,
                    bind_password_enc=COALESCE($5, bind_password_enc),
                    hr_status_url=$6, hr_status_token=$7,
                    is_active=true
              WHERE id=$8
            RETURNING *`,
            [
              payload.name,
              payload.dc_ip,
              payload.ldap_port || 389,
              payload.bind_dn,
              payload.bind_password_enc,
              payload.hr_status_url,
              payload.hr_status_token,
              existing[0].id,
            ]
          );
          updated.push(toSafeCustomer(rows[0]));
        } else {
          const { rows } = await query(
            `INSERT INTO customers (name, domain, dc_ip, ldap_port, bind_dn, bind_password_enc, hr_status_url, hr_status_token)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
              payload.name,
              payload.domain,
              payload.dc_ip,
              payload.ldap_port || 389,
              payload.bind_dn,
              payload.bind_password_enc || null,
              payload.hr_status_url,
              payload.hr_status_token,
            ]
          );
          created.push(toSafeCustomer(rows[0]));
        }
      } catch (err) {
        errors.push({ index: i, error: err.message });
      }
    }

    res.status(errors.length ? 207 : 200).json({ created, updated, errors });
  }
);

// ── PATCH /api/customers/:id ─────────────────────────────────────────
router.patch("/:id", authenticate, requireRole("admin", "engineer"), [...idValidator, ...customerValidators], async (req, res) => {
  if (validateOr400(req, res)) return;

  try {
    const payload = normalizeCustomerPayload(req.body);

    const fields = [];
    const params = [];
    const set = (col, val) => {
      if (val !== undefined) {
        params.push(val);
        fields.push(`${col} = $${params.length}`);
      }
    };

    set("name", payload.name);
    set("domain", payload.domain);
    set("dc_ip", payload.dc_ip);
    set("ldap_port", payload.ldap_port !== undefined ? payload.ldap_port || 389 : undefined);
    set("bind_dn", payload.bind_dn);
    set("bind_password_enc", payload.bind_password_enc);
    set("hr_status_url", payload.hr_status_url);
    set("hr_status_token", payload.hr_status_token);

    if (!fields.length) return res.status(400).json({ error: "No fields to update" });

    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE customers SET ${fields.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (!rows.length) return res.status(404).json({ error: "Customer not found" });
    res.json(toSafeCustomer(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/customers/:id ────────────────────────────────────────
router.delete("/:id", authenticate, requireRole("admin"), idValidator, async (req, res) => {
  if (validateOr400(req, res)) return;

  try {
    const result = await query("UPDATE customers SET is_active = false WHERE id = $1", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Customer not found" });
    res.json({ message: "Customer deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
router.get("/:id/posture", authenticate, idValidator, async (req, res) => {
  if (validateOr400(req, res)) return;

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
