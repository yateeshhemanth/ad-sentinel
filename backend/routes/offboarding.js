/**
 * HR Offboarding Status Integration
 *
 * Read-only. No AD modifications performed here.
 *
 * Each AD connection can optionally have an hr_status_url configured.
 * The portal fetches from that URL and cross-references against the AD
 * user directory to flag terminated employees with active AD accounts.
 *
 * HR API contract (what hr_status_url must return):
 *
 *   GET <hr_status_url>
 *   Authorization: Bearer <hr_status_token>   (if token configured)
 *
 *   Response (JSON):
 *   {
 *     "employees": [
 *       {
 *         "employee_id":      "E001",           // optional
 *         "email":            "john@acme.com",  // used for AD matching
 *         "name":             "John Doe",       // or "full_name"
 *         "status":           "terminated",     // see TERMINATED_STATUSES
 *         "department":       "Engineering",    // optional
 *         "title":            "Senior Dev",     // optional
 *         "termination_date": "2025-01-15",     // optional
 *         "manager":          "Jane Smith"      // optional
 *       }
 *     ]
 *   }
 *
 *   OR a flat array:  [ { ... }, { ... } ]
 *
 * Status values recognised as "terminated":
 *   terminated, inactive, resigned, left, exited, offboarded,
 *   separated, dismissed, contract_ended, relieved, absconded
 */

"use strict";

const express = require("express");
const https   = require("https");
const http    = require("http");
const { URL } = require("url");
const { query }       = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const logger = require("../config/logger");

const router = express.Router();

// ── SSRF Protection ──────────────────────────────────────────────────
// Block requests to private/loopback IP ranges (RFC 1918, RFC 4193, loopback, link-local).
// This prevents engineers/admins from pointing the HR URL at internal infrastructure.

const net = require("net");

const BLOCKED_CIDRS = [
  // IPv4 private + special ranges
  { net: "10.0.0.0",    bits: 8  },
  { net: "172.16.0.0",  bits: 12 },
  { net: "192.168.0.0", bits: 16 },
  { net: "127.0.0.0",   bits: 8  },   // loopback
  { net: "169.254.0.0", bits: 16 },   // link-local / AWS metadata
  { net: "100.64.0.0",  bits: 10 },   // shared address space (CGNAT)
  { net: "0.0.0.0",     bits: 8  },   // "this" network
];

function ipToInt(ip) {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isBlockedIPv4(ip) {
  const n = ipToInt(ip);
  return BLOCKED_CIDRS.some(({ net: cnet, bits }) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipToInt(cnet) & mask);
  });
}

/**
 * Resolve the hostname in `rawUrl` and throw if it resolves to a
 * private/internal IP address (SSRF prevention).
 */
async function assertSafeUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { throw new Error("Invalid HR status URL: " + rawUrl); }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("HR status URL must use http or https.");
  }

  // Reject if hostname is already a private IP literal
  if (net.isIPv4(parsed.hostname) && isBlockedIPv4(parsed.hostname)) {
    throw new Error("HR status URL must not point to a private/internal IP address.");
  }

  // DNS resolve and check all returned addresses
  const dns = require("dns").promises;
  let addresses = [];
  try {
    const result = await dns.lookup(parsed.hostname, { all: true });
    addresses = result.map(r => r.address);
  } catch {
    throw new Error(`Cannot resolve hostname: ${parsed.hostname}`);
  }

  for (const addr of addresses) {
    if (net.isIPv4(addr) && isBlockedIPv4(addr)) {
      throw new Error(
        `HR status URL resolves to a private IP (${addr}). ` +
        "Only publicly-routable endpoints are permitted."
      );
    }
  }
}

// ── Constants ────────────────────────────────────────────────────────

const TERMINATED_STATUSES = new Set([
  "terminated","inactive","resigned","left","exited","offboarded",
  "separated","dismissed","contract_ended","relieved","absconded",
  "notice_period","notice period",
]);

function isTerminated(status) {
  if (!status) return false;
  const s = status.toLowerCase().trim().replace(/\s+/g,"_");
  return [...TERMINATED_STATUSES].some(k => s.includes(k));
}

// Guess sAMAccountName from email or name
function guessAdAccount(emp) {
  if (emp.email) {
    const local = emp.email.split("@")[0];
    if (local) return local.toLowerCase();
  }
  const name = emp.name || emp.full_name || emp.employee_name || "";
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]+"."+parts[parts.length-1]).toLowerCase();
    return parts[0].toLowerCase();
  }
  return null;
}

// ── Fetch from HR URL ────────────────────────────────────────────────

function fetchUrl(rawUrl, token) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); }
    catch (e) { return reject(new Error("Invalid HR status URL: " + rawUrl)); }

    const lib = parsed.protocol === "https:" ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   "GET",
      headers:  {
        "Accept":     "application/json",
        "User-Agent": "ADSentinel-HRSync/1.0",
        ...(token ? { "Authorization": "Bearer " + token } : {}),
      },
      timeout: 15000,
    };

    const req = lib.request(opts, (res) => {
      if (res.statusCode === 401) return reject(new Error("HR API returned 401 Unauthorized — check the auth token"));
      if (res.statusCode === 403) return reject(new Error("HR API returned 403 Forbidden — token may lack permissions"));
      if (res.statusCode >= 400) return reject(new Error("HR API returned HTTP " + res.statusCode));

      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("HR API did not return valid JSON"));
        }
      });
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("HR API request timed out after 15s")); });
    req.on("error",   (e) => reject(new Error("HR API connection error: " + e.message)));
    req.end();
  });
}

// Normalise raw HR API response → flat employee array
function normaliseEmployees(data) {
  // Accept: { employees: [...] }  OR  { data: [...] }  OR  flat array
  const list = Array.isArray(data) ? data
             : Array.isArray(data.employees) ? data.employees
             : Array.isArray(data.data)      ? data.data
             : [];

  return list.map(e => ({
    employee_id:      e.employee_id || e.emp_id || e.id || "",
    name:             e.name || e.full_name || e.employee_name || e.display_name || "",
    email:            (e.email || e.email_address || e.work_email || "").toLowerCase().trim(),
    department:       e.department || e.dept || "",
    title:            e.title || e.job_title || e.designation || "",
    status:           e.status || e.employment_status || e.emp_status || "",
    termination_date: e.termination_date || e.exit_date || e.last_day || e.term_date || null,
    manager:          e.manager || e.manager_name || e.reporting_manager || "",
    raw:              e,
  }));
}

// Cache fetched employees into hr_employees table (upsert by customer_id + email)
async function cacheEmployees(customerId, employees) {
  // Clear old records for this customer first
  await query("DELETE FROM hr_employees WHERE customer_id = $1", [customerId]);

  let saved = 0;
  for (const e of employees) {
    if (!e.email && !e.employee_id) continue; // need some identifier
    try {
      await query(
        `INSERT INTO hr_employees
           (customer_id, employee_id, name, email, department, title,
            status, termination_date, manager, raw, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (customer_id, email)
         DO UPDATE SET
           employee_id=EXCLUDED.employee_id, name=EXCLUDED.name,
           department=EXCLUDED.department,   title=EXCLUDED.title,
           status=EXCLUDED.status,           termination_date=EXCLUDED.termination_date,
           manager=EXCLUDED.manager,         raw=EXCLUDED.raw,
           fetched_at=NOW()`,
        [
          customerId,
          e.employee_id || null,
          e.name        || null,
          e.email       || null,
          e.department  || null,
          e.title       || null,
          e.status,
          e.termination_date || null,
          e.manager     || null,
          JSON.stringify(e.raw),
        ]
      );
      saved++;
    } catch {}
  }
  return saved;
}

// ── POST /api/offboarding/sync/:customerId ───────────────────────────
// Fetch from the customer's hr_status_url and cache results
router.post("/sync/:customerId", authenticate, requireRole("admin","engineer"), async (req, res) => {
  const { customerId } = req.params;

  const { rows } = await query("SELECT * FROM customers WHERE id=$1", [customerId]);
  if (!rows.length) return res.status(404).json({ error: "Customer not found" });
  const customer = rows[0];

  if (!customer.hr_status_url) {
    return res.status(400).json({
      error: "No HR Status URL configured for this domain.",
      hint:  "Go to Settings → AD Connections → Edit → set the HR Status URL field.",
    });
  }

  try {
    logger.info(`HR sync: fetching ${customer.hr_status_url} for ${customer.name}`);
    await assertSafeUrl(customer.hr_status_url);   // SSRF guard
    const raw  = await fetchUrl(customer.hr_status_url, customer.hr_status_token);
    const emps = normaliseEmployees(raw);
    const saved = await cacheEmployees(customerId, emps);

    logger.info(`HR sync: ${emps.length} employees fetched, ${saved} cached for ${customer.name}`);
    res.json({
      success:    true,
      total:      emps.length,
      cached:     saved,
      fetched_at: new Date().toISOString(),
      customer:   customer.name,
    });
  } catch (err) {
    logger.warn(`HR sync failed for ${customer.name}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/offboarding/cross-reference/:customerId ─────────────────
// Cross-reference cached HR records with AD users — no AD queries made
router.get("/cross-reference/:customerId", authenticate, async (req, res) => {
  const { customerId } = req.params;
  const { rows: custRows } = await query("SELECT name, hr_status_url FROM customers WHERE id=$1", [customerId]);
  if (!custRows.length) return res.status(404).json({ error: "Customer not found" });

  // Get cached HR employees
  const { rows: hrEmps } = await query(
    "SELECT * FROM hr_employees WHERE customer_id=$1 ORDER BY name",
    [customerId]
  );

  // Get AD users for this customer
  const { rows: adUsers } = await query(
    "SELECT sam_account_name, display_name, email, is_enabled, department, last_logon FROM ad_users WHERE customer_id=$1",
    [customerId]
  );

  if (!hrEmps.length) {
    return res.json({
      customer:       custRows[0].name,
      hr_configured:  !!custRows[0].hr_status_url,
      hr_synced:      false,
      records:        [],
      summary:        { total:0, active:0, terminated:0, flagged:0, resolved:0, not_in_ad:0 },
    });
  }

  // Build AD lookup by email and sAMAccountName
  const adByEmail   = {};
  const adByAccount = {};
  adUsers.forEach(u => {
    if (u.email)            adByEmail[u.email.toLowerCase()]           = u;
    if (u.sam_account_name) adByAccount[u.sam_account_name.toLowerCase()] = u;
  });

  // Build cross-reference records
  const records = hrEmps.map(emp => {
    const terminated = isTerminated(emp.status);
    const email = emp.email?.toLowerCase();
    const guessedAcct = guessAdAccount(emp);

    const adUser = (email && adByEmail[email])
                || (guessedAcct && adByAccount[guessedAcct])
                || null;

    let flag = "ok";
    if (terminated) {
      if (!adUser)              flag = "not_in_ad";
      else if (adUser.is_enabled)  flag = "flagged";   // terminated but AD account still active
      else                      flag = "resolved";  // terminated and AD already disabled
    }

    return {
      employee_id:      emp.employee_id,
      name:             emp.name,
      email:            emp.email,
      department:       emp.department,
      title:            emp.title,
      hr_status:        emp.status,
      termination_date: emp.termination_date,
      is_terminated:    terminated,
      ad_account:       adUser?.sam_account_name || null,
      ad_display_name:  adUser?.display_name     || null,
      ad_enabled:       adUser?.is_enabled       ?? null,
      ad_last_logon:    adUser?.last_logon        || null,
      ad_found:         !!adUser,
      flag,                   // "ok" | "flagged" | "resolved" | "not_in_ad"
      fetched_at:       emp.fetched_at,
    };
  });

  const terminated = records.filter(r => r.is_terminated);
  const summary = {
    total:      records.length,
    active:     records.filter(r => !r.is_terminated).length,
    terminated: terminated.length,
    flagged:    terminated.filter(r => r.flag === "flagged").length,
    resolved:   terminated.filter(r => r.flag === "resolved").length,
    not_in_ad:  terminated.filter(r => r.flag === "not_in_ad").length,
  };

  res.json({
    customer:      custRows[0].name,
    hr_configured: !!custRows[0].hr_status_url,
    hr_synced:     true,
    last_fetched:  hrEmps[0]?.fetched_at || null,
    summary,
    records,
  });
});

// ── GET /api/offboarding/overview ────────────────────────────────────
// Cross-customer summary — which domains have HR configured + flagged counts
router.get("/overview", authenticate, async (req, res) => {
  try {
    const { rows: customers } = await query(
      "SELECT id, name, hr_status_url FROM customers WHERE is_active=true ORDER BY name"
    );

    const overview = await Promise.all(customers.map(async (c) => {
      const { rows: hr } = await query(
        "SELECT status FROM hr_employees WHERE customer_id=$1",
        [c.id]
      );
      const { rows: ad } = await query(
        "SELECT email, is_enabled FROM ad_users WHERE customer_id=$1",
        [c.id]
      );
      const { rows: sync } = await query(
        "SELECT MAX(fetched_at) AS last_synced FROM hr_employees WHERE customer_id=$1",
        [c.id]
      );

      const terminated = hr.filter(e => isTerminated(e.status));
      const adEnabledEmails = new Set(ad.filter(u => u.is_enabled && u.email).map(u => u.email.toLowerCase()));

      return {
        customer_id:   c.id,
        customer_name: c.name,
        hr_configured: !!c.hr_status_url,
        hr_total:      hr.length,
        hr_terminated: terminated.length,
        ad_users:      ad.length,
        last_synced:   sync[0]?.last_synced || null,
      };
    }));

    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/offboarding/api-contract ────────────────────────────────
// Returns the expected JSON contract for the HR API — useful for IT teams building the endpoint
router.get("/api-contract", authenticate, (req, res) => {
  res.json({
    description: "ADSentinel HR Status API Contract",
    version:     "1.0",
    method:      "GET",
    auth:        "Bearer token in Authorization header (optional — configure in AD Connections)",
    response: {
      format:  "JSON object with 'employees' array, OR flat array",
      example: {
        employees: [
          {
            employee_id:      "E001",
            email:            "john.doe@company.com",
            name:             "John Doe",
            status:           "active",
            department:       "Engineering",
            title:            "Senior Developer",
            termination_date: null,
            manager:          "Jane Smith",
          },
          {
            employee_id:      "E042",
            email:            "alice.jones@company.com",
            name:             "Alice Jones",
            status:           "terminated",
            department:       "Finance",
            title:            "Accountant",
            termination_date: "2025-01-15",
            manager:          "Bob Wilson",
          },
        ],
      },
    },
    terminated_status_values: [...TERMINATED_STATUSES],
    ad_matching: [
      "Primary:  email address (most reliable — use work email that matches AD mail attribute)",
      "Fallback: sAMAccountName guessed as firstname.lastname from the name field",
    ],
    notes: [
      "ADSentinel is read-only — no AD modifications are performed",
      "Sync is manual (button) or can be triggered via POST /api/offboarding/sync/:customerId",
      "Results are cross-referenced against the last AD scan — run a scan first",
    ],
  });
});

// ── POST /api/offboarding/test-url ───────────────────────────────────
// Test an HR API URL before saving — returns sample employees + count.
// Restricted to admin/engineer — analysts must not be able to probe arbitrary URLs.
router.post("/test-url", authenticate, requireRole("admin", "engineer"), async (req, res) => {
  const { url, token } = req.body;
  if (!url) return res.status(400).json({ ok: false, message: "URL is required" });

  try {
    await assertSafeUrl(url);   // SSRF guard
    const raw  = await fetchUrl(url, token);
    const emps = normaliseEmployees(raw);
    const terminated = emps.filter(e => isTerminated(e.status));

    res.json({
      ok:             true,
      message:        `HR API reachable — ${emps.length} employee records found`,
      employee_count: emps.length,
      terminated:     terminated.length,
      sample:         emps.slice(0, 3).map(e => ({ email: e.email, name: e.name, status: e.status })),
    });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

module.exports = router;
