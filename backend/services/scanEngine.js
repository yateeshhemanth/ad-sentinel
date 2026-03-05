/**
 * ADSentinel Scan Engine v3 — Real LDAP Implementation
 *
 * Uses ldapjs to query Active Directory via LDAP/LDAPS.
 * Bind credentials are optional — will attempt anonymous bind if not provided.
 *
 * Template variables in finding_library ldap_filter:
 *   __DC__              → DC=domain,DC=local  (derived from customer.domain)
 *   __90_DAYS_AGO__     → Active Directory timestamp 90 days back
 *   __180_DAYS_AGO__    → Active Directory timestamp 180 days back
 *   __365_DAYS_AGO__    → Active Directory timestamp 365 days back
 */

"use strict";

const ldap           = require("ldapjs");
const path           = require("path");
const { query }      = require("../config/db");
const { decrypt }    = require("../config/crypto");
const logger         = require("../config/logger");
const { notifyNewAlerts } = require("./notificationService");

// ─────────────────────────────────────────────────────────────────────
// Finding library helpers
// ─────────────────────────────────────────────────────────────────────
const LIBRARY_PATH = path.join(__dirname, "../data/finding_library.json");
let _library = null;

function getLibrary() {
  if (!_library) _library = require(LIBRARY_PATH);
  return _library;
}

function reloadLibrary() {
  delete require.cache[require.resolve(LIBRARY_PATH)];
  _library = require(LIBRARY_PATH);
  logger.info(`Finding library reloaded — ${_library.findings.length} checks`);
  return _library;
}

function buildComplianceSummary(compliance) {
  const parts = [];
  if (compliance.cis_v8?.length)      parts.push("CIS: " + compliance.cis_v8.join(", "));
  if (compliance.nist_800_53?.length) parts.push("NIST: " + compliance.nist_800_53.join(", "));
  if (compliance.iso_27001?.length)   parts.push("ISO: " + compliance.iso_27001.join(", "));
  if (compliance.soc2?.length)        parts.push("SOC2: " + compliance.soc2.join(", "));
  if (compliance.mitre?.length)       parts.push("MITRE: " + compliance.mitre.map(m => m.id).join(", "));
  return parts.join(" | ");
}

// ─────────────────────────────────────────────────────────────────────
// LDAP timestamp helpers
// ─────────────────────────────────────────────────────────────────────

// Convert JS Date to Windows FILETIME (100-ns intervals since 1601-01-01)
function toADTimestamp(date) {
  const EPOCH_DIFF_MS = 11644473600000n;
  const ms = BigInt(date.getTime()) + EPOCH_DIFF_MS;
  return (ms * 10000n).toString();
}

function daysAgoAD(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toADTimestamp(d);
}

// Convert Windows FILETIME string to JS Date
function fromADTimestamp(val) {
  // Reject known "never" sentinels and empty values
  if (!val || val === "0" || val === "9223372036854775807") return null;

  try {
    const big = BigInt(val);
    // Sanity check: FILETIME must be > 0 and within a plausible range
    // Min: Jan 1 1970 in FILETIME = 116444736000000000
    // Max: year 9999 roughly
    if (big <= 0n) return null;

    const EPOCH_DIFF_MS = 11644473600000n; // ms between 1601-01-01 and 1970-01-01
    const ms = big / 10000n - EPOCH_DIFF_MS;

    // Reject negative ms (dates before 1970 — invalid for logon/pwd timestamps)
    if (ms < 0n) return null;

    const d = new Date(Number(ms));
    // Reject NaN dates or unreasonably far future (year > 2100)
    if (isNaN(d.getTime()) || d.getFullYear() > 2100) return null;

    return d;
  } catch {
    return null;
  }
}

// "testms.local" → "DC=testms,DC=local"
function domainToDC(domain) {
  return domain.split(".").map(p => "DC=" + p).join(",");
}

// Replace template vars in ldap_filter
function resolveFilter(filter, dcDN) {
  return filter
    .replace(/__DC__/g, dcDN)
    .replace(/__90_DAYS_AGO__/g,  daysAgoAD(90))
    .replace(/__180_DAYS_AGO__/g, daysAgoAD(180))
    .replace(/__365_DAYS_AGO__/g, daysAgoAD(365));
}

// ─────────────────────────────────────────────────────────────────────
// LDAP client helpers
// ─────────────────────────────────────────────────────────────────────

function createClient(dc_ip, ldap_port, useTLS, allowSelfSigned) {
  const port   = ldap_port || (useTLS ? 636 : 389);
  const scheme = useTLS ? "ldaps" : "ldap";
  return ldap.createClient({
    url:            scheme + "://" + dc_ip + ":" + port,
    timeout:        20000,
    connectTimeout: 15000,
    // Only disable cert verification if explicitly opted in (e.g. for dev/self-signed DCs).
    // Production deployments should use a proper CA cert instead.
    tlsOptions:     useTLS ? { rejectUnauthorized: allowSelfSigned !== true } : undefined,
    reconnect:      false,
  });
}

function bindClient(client, dn, password) {
  return new Promise((resolve, reject) => {
    client.bind(dn || "", password || "", (err) => {
      if (err) reject(err);
      else     resolve();
    });
  });
}

function unbindClient(client) {
  return new Promise((resolve) => {
    try { client.unbind(() => resolve()); }
    catch { resolve(); }
  });
}

// Search LDAP — returns array of entry attribute objects
function searchLdap(client, base, filter, attributes, scope) {
  scope = scope || "sub";
  return new Promise((resolve, reject) => {
    const entries = [];
    client.search(base, { filter: filter, attributes: attributes, scope: scope, sizeLimit: 5000 }, (err, res) => {
      if (err) return reject(err);

      res.on("searchEntry", (entry) => {
        const obj = {};
        for (const attr of entry.attributes) {
          const vals = attr.values || [];
          obj[attr.type] = vals.length === 1 ? vals[0] : vals;
        }
        entries.push(obj);
      });

      res.on("error", (err) => {
        // Error code 4 = size limit exceeded — return partial results
        if (err.code === 4) resolve(entries);
        else reject(err);
      });

      res.on("end", () => resolve(entries));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// userAccountControl flag helpers
// ─────────────────────────────────────────────────────────────────────
const UAC_ACCOUNTDISABLE       = 0x0002;
const UAC_PASSWD_NOTREQD       = 0x0020;
const UAC_DONT_EXPIRE_PASSWORD = 0x10000;
const UAC_PASSWORD_EXPIRED     = 0x800000;

function hasFlag(uac, flag) {
  return (parseInt(uac || 0) & flag) !== 0;
}

// ─────────────────────────────────────────────────────────────────────
// Collect full AD user directory
// ─────────────────────────────────────────────────────────────────────
async function collectUserDirectory(client, dcDN) {
  const entries = await searchLdap(
    client, dcDN,
    "(&(objectCategory=person)(objectClass=user))",
    [
      "sAMAccountName", "displayName", "mail", "department", "title",
      "userAccountControl", "pwdLastSet", "lastLogonTimestamp", "lastLogon",
      "adminCount", "memberOf", "whenCreated", "distinguishedName",
    ]
  );

  return entries.map(e => {
    const uac = parseInt(e.userAccountControl || 0);
    const lastLogonTS = e.lastLogonTimestamp || e.lastLogon;
    return {
      sam_account_name:       e.sAMAccountName  || "",
      display_name:           e.displayName      || "",
      email:                  e.mail             || "",
      department:             e.department       || "",
      title:                  e.title            || "",
      is_enabled:             !hasFlag(uac, UAC_ACCOUNTDISABLE),
      is_admin:               e.adminCount === "1",
      password_never_expires: hasFlag(uac, UAC_DONT_EXPIRE_PASSWORD),
      password_expired:       hasFlag(uac, UAC_PASSWORD_EXPIRED),
      password_not_required:  hasFlag(uac, UAC_PASSWD_NOTREQD),
      last_logon:             fromADTimestamp(lastLogonTS),
      pwd_last_set:           fromADTimestamp(e.pwdLastSet),
      when_created:           e.whenCreated ? (() => { const d = new Date(e.whenCreated); return isNaN(d.getTime()) ? null : d; })() : null,
      member_of:              Array.isArray(e.memberOf) ? e.memberOf : (e.memberOf ? [e.memberOf] : []),
      distinguished_name:     e.distinguishedName || "",
      user_account_control:   uac,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Store user directory snapshot (upsert)
// ─────────────────────────────────────────────────────────────────────
async function storeUserDirectory(customerId, customerName, users) {
  let stored = 0;
  for (const u of users) {
    try {
      // Sanitize any Date fields — reject Invalid Date objects before they hit Postgres
      const safeDate = (d) => (d instanceof Date && !isNaN(d.getTime())) ? d : null;

      await query(
        `INSERT INTO ad_users
           (customer_id, customer_name, sam_account_name, display_name, email,
            department, title, is_enabled, is_admin, password_never_expires,
            password_expired, password_not_required, last_logon, pwd_last_set,
            when_created, member_of, distinguished_name, raw_flags, scanned_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
         ON CONFLICT (customer_id, sam_account_name)
         DO UPDATE SET
           display_name           = EXCLUDED.display_name,
           email                  = EXCLUDED.email,
           department             = EXCLUDED.department,
           title                  = EXCLUDED.title,
           is_enabled             = EXCLUDED.is_enabled,
           is_admin               = EXCLUDED.is_admin,
           password_never_expires = EXCLUDED.password_never_expires,
           password_expired       = EXCLUDED.password_expired,
           password_not_required  = EXCLUDED.password_not_required,
           last_logon             = EXCLUDED.last_logon,
           pwd_last_set           = EXCLUDED.pwd_last_set,
           member_of              = EXCLUDED.member_of,
           raw_flags              = EXCLUDED.raw_flags,
           scanned_at             = NOW()`,
        [
          customerId, customerName,
          u.sam_account_name, u.display_name, u.email,
          u.department, u.title,
          u.is_enabled, u.is_admin,
          u.password_never_expires, u.password_expired, u.password_not_required,
          safeDate(u.last_logon), safeDate(u.pwd_last_set), safeDate(u.when_created),
          JSON.stringify(u.member_of),
          u.distinguished_name,
          u.user_account_control,
        ]
      );
      stored++;
    } catch (e) {
      logger.warn("Failed to store user " + u.sam_account_name + ": " + e.message);
    }
  }
  return stored;
}

// ─────────────────────────────────────────────────────────────────────
// Run all 31 finding checks
// ─────────────────────────────────────────────────────────────────────


function mapInventoryEntry(entry, objectType) {
  const attrs = entry || {};
  return {
    object_type: objectType,
    object_key: attrs.sAMAccountName || attrs.cn || attrs.name || attrs.distinguishedName || null,
    distinguished_name: attrs.distinguishedName || null,
    attributes: attrs,
  };
}

async function collectInventoryObjects(client, dcDN) {
  const plans = [
    { type: "user", filter: "(&(objectClass=user)(!(objectClass=computer)))", attrs: ["sAMAccountName", "distinguishedName", "mail", "whenCreated"] },
    { type: "group", filter: "(objectClass=group)", attrs: ["cn", "distinguishedName", "groupType", "whenCreated"] },
    { type: "computer", filter: "(objectClass=computer)", attrs: ["cn", "dNSHostName", "distinguishedName", "operatingSystem", "whenCreated"] },
    { type: "ou", filter: "(objectClass=organizationalUnit)", attrs: ["ou", "distinguishedName", "whenCreated"] },
    { type: "gpo", filter: "(objectClass=groupPolicyContainer)", attrs: ["displayName", "name", "distinguishedName", "whenCreated"] },
  ];

  const out = { user: [], group: [], computer: [], ou: [], gpo: [] };
  for (const plan of plans) {
    try {
      const entries = await searchLdap(client, dcDN, plan.filter, plan.attrs, "sub");
      out[plan.type] = entries.map(e => mapInventoryEntry(e, plan.type));
    } catch (err) {
      logger.warn(`Inventory collection failed for ${plan.type}: ${err.message}`);
    }
  }
  return out;
}

async function storeInventorySnapshot(customerId, customerName, inventory) {
  const counts = {
    users: inventory.user.length,
    groups: inventory.group.length,
    computers: inventory.computer.length,
    ous: inventory.ou.length,
    gpos: inventory.gpo.length,
  };

  const { rows } = await query(
    `INSERT INTO ad_inventory_snapshots
      (customer_id, customer_name, users_count, groups_count, computers_count, ous_count, gpos_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [customerId, customerName, counts.users, counts.groups, counts.computers, counts.ous, counts.gpos]
  );
  const snapshotId = rows[0].id;

  const all = [...inventory.user, ...inventory.group, ...inventory.computer, ...inventory.ou, ...inventory.gpo];
  for (const obj of all) {
    try {
      await query(
        `INSERT INTO ad_inventory_objects
          (snapshot_id, customer_id, customer_name, object_type, object_key, distinguished_name, attributes, scanned_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [snapshotId, customerId, customerName, obj.object_type, obj.object_key, obj.distinguished_name, JSON.stringify(obj.attributes || {})]
      );
    } catch (err) {
      logger.warn(`Inventory object store failed (${obj.object_type}): ${err.message}`);
    }
  }

  return { snapshotId, ...counts };
}

// ─────────────────────────────────────────────────────────────────────
// Run all 31 finding checks
// ─────────────────────────────────────────────────────────────────────
async function runFindingChecks(client, dcDN, auditParams) {
  const lib     = getLibrary();
  const results = [];

  for (const finding of lib.findings) {
    if (!finding.ldap_filter) continue;

    try {
      const filter     = resolveFilter(finding.ldap_filter, dcDN);
      const attributes = finding.ldap_attributes || ["sAMAccountName", "distinguishedName"];

      // Domain-level checks use "base" scope on the root DN
      const isRootSearch = finding.ldap_filter.includes("objectClass=domainDNS")
                        || finding.ldap_filter.includes("objectClass=trustedDomain");
      const scope = isRootSearch ? "base" : "sub";

      let entries;
      try {
        entries = await searchLdap(client, dcDN, filter, attributes, scope);
      } catch (searchErr) {
        logger.warn("[" + finding.id + "] search error: " + searchErr.message);
        continue;
      }

      if (entries.length === 0) continue;

      // Extract affected account names
      const affectedUsers = entries
        .map(e => {
          if (e.sAMAccountName) return e.sAMAccountName;
          if (e.cn) return e.cn;
          if (e.distinguishedName) return e.distinguishedName.split(",")[0].replace("CN=","");
          return null;
        })
        .filter(Boolean)
        .slice(0, 50);

      results.push({
        finding_id:         finding.id,
        title:              finding.title,
        description:        finding.description,
        severity:           finding.severity,
        risk_score:         finding.risk_score,
        category:           finding.category,
        affected_count:     entries.length,
        affected_users:     affectedUsers,
        remediation:        finding.remediation || "Review AD policy baseline and enforce least privilege.",
        compliance:         finding.compliance,
        compliance_summary: buildComplianceSummary(finding.compliance),
      });

      logger.info("[" + finding.id + "] " + finding.severity.toUpperCase() + " — " + entries.length + " match(es)");
    } catch (err) {
      logger.warn("[" + finding.id + "] unexpected error: " + err.message);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────
// Translate common LDAP errors to actionable messages
// ─────────────────────────────────────────────────────────────────────
function translateLdapError(err, customer) {
  const msg = err.message || "";
  if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET")) {
    return "Cannot connect to " + customer.dc_ip + ":" + (customer.ldap_port||389) +
           " — DC unreachable or LDAP port blocked. Check network/firewall.";
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("ETIMED")) {
    return "Connection timed out to " + customer.dc_ip + " — DC may be unreachable from this host.";
  }
  if (err.code === 49 || msg.includes("Invalid Credentials") || msg.includes("80090308")) {
    return "Invalid credentials for bind DN: " + customer.bind_dn +
           ". Check the password in Settings → AD Connections.";
  }
  if (err.code === 50 || msg.includes("Insufficient Access")) {
    return "Insufficient permissions for " + customer.bind_dn +
           ". The service account needs read access to the directory.";
  }
  if (msg.includes("certificate") || msg.includes("self signed")) {
    return "TLS certificate error — use port 389 (plaintext LDAP) or trust the DC certificate.";
  }
  return msg;
}

// ─────────────────────────────────────────────────────────────────────
// Main scan entry point
// ─────────────────────────────────────────────────────────────────────
async function runScan(customerId) {
  const { rows: custRows } = await query("SELECT * FROM customers WHERE id = $1", [customerId]);
  if (!custRows.length) throw new Error("Customer " + customerId + " not found");
  const customer = custRows[0];

  if (!customer.dc_ip) {
    logger.warn("Scan skipped for " + customer.name + ": DC IP not configured");
    return {
      findings: 0, new_alerts: 0, customer: customer.name,
      status: "skipped",
      reason: "DC IP not configured. Go to Settings → AD Connections → Edit.",
    };
  }

  // Load audit params
  let auditParams = {};
  try {
    const { rows: s } = await query("SELECT value FROM app_settings WHERE key = 'audit_params'");
    if (s.length) auditParams = JSON.parse(s[0].value);
  } catch (err) {
    logger.warn("Invalid audit_params JSON; using defaults. " + err.message);
  }

  const port   = parseInt(customer.ldap_port) || 389;
  const useTLS = port === 636 || port === 3269;
  const dcDN   = domainToDC(customer.domain);

  logger.info("Scan starting: " + customer.name + " @ " + customer.dc_ip + ":" + port + " base=" + dcDN);

  const client = createClient(customer.dc_ip, port, useTLS, customer.allow_self_signed);
  client.on("error", (err) => logger.warn("LDAP socket error: " + err.message));

  try {
    // Bind — decrypt the stored password before use
    if (customer.bind_dn && customer.bind_password_enc) {
      const bindPassword = decrypt(customer.bind_password_enc);
      if (!bindPassword) {
        throw new Error(
          "Failed to decrypt bind password for " + customer.name +
          ". Check FIELD_ENCRYPTION_KEY matches the key used when the password was saved."
        );
      }
      await bindClient(client, customer.bind_dn, bindPassword);
      logger.info("Bound as: " + customer.bind_dn);
    } else {
      await bindClient(client, "", "");
      logger.info("Anonymous bind for " + customer.name);
    }

    // 1. Collect full user directory
    let userCount = 0;
    logger.info("Collecting user directory…");
    try {
      const adUsers = await collectUserDirectory(client, dcDN);
      userCount = await storeUserDirectory(customerId, customer.name, adUsers);
      logger.info("User directory: " + userCount + " accounts stored");
    } catch (err) {
      logger.warn("User directory error: " + err.message);
    }

    // 2. Collect broader AD object inventory (historical snapshots)
    let inventorySummary = { snapshotId: null, users: 0, groups: 0, computers: 0, ous: 0, gpos: 0 };
    try {
      const inventory = await collectInventoryObjects(client, dcDN);
      inventorySummary = await storeInventorySnapshot(customerId, customer.name, inventory);
      logger.info(`Inventory snapshot ${inventorySummary.snapshotId} stored: users=${inventorySummary.users}, groups=${inventorySummary.groups}, computers=${inventorySummary.computers}, ous=${inventorySummary.ous}, gpos=${inventorySummary.gpos}`);
    } catch (err) {
      logger.warn("Inventory snapshot failed: " + err.message);
    }

    // 3. Run finding checks
    logger.info("Running " + getLibrary().findings.length + " finding checks…");
    const findings = await runFindingChecks(client, dcDN, auditParams);

    // 4. Write alerts
    let created = 0, skipped = 0;
    const createdAlerts = [];
    for (const f of findings) {
      const { rows: existing } = await query(
        "SELECT id FROM alerts WHERE customer_id=$1 AND details->>'finding_id'=$2 AND is_acked=false",
        [customerId, f.finding_id]
      );
      if (existing.length) { skipped++; continue; }

      await query(
        "INSERT INTO alerts (customer_id, customer_name, message, severity, details) VALUES ($1,$2,$3,$4,$5)",
        [
          customerId, customer.name,
          "[" + f.finding_id + "] " + f.title + " — " + f.affected_count + " account(s) affected",
          f.severity,
          JSON.stringify({
            finding_id:         f.finding_id,
            category:           f.category,
            description:        f.description,
            remediation:        f.remediation,
            risk_score:         f.risk_score,
            affected_count:     f.affected_count,
            affected_users:     f.affected_users,
            compliance:         f.compliance,
            compliance_summary: f.compliance_summary,
            scan_type:          "ldap",
            scanned_at:         new Date().toISOString(),
          }),
        ]
      );
      createdAlerts.push({
        finding_id: f.finding_id,
        title: f.title,
        severity: f.severity,
        affected_count: f.affected_count,
      });
      created++;
    }

    await query("UPDATE customers SET last_scan = NOW() WHERE id = $1", [customerId]);

    const summary = {
      findings:      findings.length,
      new_alerts:    created,
      existing_open: skipped,
      users_stored:  userCount,
      inventory: {
        snapshot_id: inventorySummary.snapshotId,
        users: inventorySummary.users,
        groups: inventorySummary.groups,
        computers: inventorySummary.computers,
        ous: inventorySummary.ous,
        gpos: inventorySummary.gpos,
      },
      customer:      customer.name,
      dc:            customer.dc_ip + ":" + port,
      base_dn:       dcDN,
      status:        "completed",
    };

    await notifyNewAlerts(summary, createdAlerts);

    logger.info("Scan complete: " + JSON.stringify(summary));
    return summary;

  } catch (err) {
    const friendly = translateLdapError(err, customer);
    logger.error("Scan failed for " + customer.name + ": " + friendly);
    throw new Error(friendly);
  } finally {
    await unbindClient(client);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Library stats
// ─────────────────────────────────────────────────────────────────────
function getLibraryStats() {
  const lib = getLibrary();
  const bySeverity = {}, byCategory = {};
  const frameworks = { cis_v8:0, nist_800_53:0, iso_27001:0, soc2:0, mitre:0 };
  for (const f of lib.findings) {
    bySeverity[f.severity] = (bySeverity[f.severity]||0) + 1;
    byCategory[f.category] = (byCategory[f.category]||0) + 1;
    if (f.compliance.cis_v8?.length)      frameworks.cis_v8++;
    if (f.compliance.nist_800_53?.length) frameworks.nist_800_53++;
    if (f.compliance.iso_27001?.length)   frameworks.iso_27001++;
    if (f.compliance.soc2?.length)        frameworks.soc2++;
    if (f.compliance.mitre?.length)       frameworks.mitre++;
  }
  return { version:lib.version, total:lib.findings.length, by_severity:bySeverity, by_category:byCategory, frameworks };
}

module.exports = { runScan, getLibrary, reloadLibrary, getLibraryStats };
