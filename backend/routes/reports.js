const express       = require("express");
const path          = require("path");
const fs            = require("fs");
const { stringify } = require("csv-stringify/sync");
const PDFDocument   = require("pdfkit");
const { authenticate } = require("../middleware/auth");
const { query }        = require("../config/db");
const logger           = require("../config/logger");

const router = express.Router();
const REPORTS_DIR = path.join(__dirname, "../reports");
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ── GET /api/reports/types ─────────────────────────────────────────
router.get("/types", authenticate, (req, res) => {
  res.json([
    { id:"executive_summary",     label:"Executive Summary",        formats:["pdf","csv"] },
    { id:"password_vulnerability", label:"Password Vulnerability",   formats:["pdf","csv"] },
    { id:"stale_accounts",         label:"Stale Account Report",     formats:["pdf","csv"] },
    { id:"policy_compliance",      label:"Policy Compliance",        formats:["pdf","csv"] },
    { id:"privileged_accounts",    label:"Privileged Account Audit", formats:["pdf","csv"] },
    { id:"compliance_mapping",     label:"Compliance Mapping",       formats:["pdf","csv"] },
    { id:"kerberos_risks",         label:"Kerberos Attack Surface",  formats:["pdf","csv"] },
    { id:"trust_analysis",         label:"Trust Analysis",           formats:["pdf","csv"] },
    { id:"ad_health_dashboard",    label:"AD Health Dashboard",      formats:["pdf","csv"] },
  ]);
});

// ── POST /api/reports/generate ─────────────────────────────────────
router.post("/generate", authenticate, async (req, res) => {
  let { type, format = "pdf", customer_id, customer_name } = req.body;
  if (!type) return res.status(400).json({ error: "type is required" });

  // Strip format suffix some clients append (e.g. "stale_accounts_csv")
  if (type.endsWith("_csv")) { format = "csv"; type = type.slice(0, -4); }
  if (type.endsWith("_pdf")) { format = "pdf"; type = type.slice(0, -4); }

  // Normalise plural/variant names
  const TYPE_MAP = {
    password_vulnerabilities: "password_vulnerability",
    kerberos_risk:            "kerberos_risks",
  };
  type = TYPE_MAP[type] || type;

  try {
    const data     = await fetchReportData(type, customer_id, customer_name);
    const filename = `${type}_${customer_id || "all"}_${Date.now()}.${format}`;
    const filepath = path.join(REPORTS_DIR, filename);

    if (format === "csv") {
      await generateCSV(data, filepath, type);
    } else {
      await generatePDF(data, filepath, type, data.customerName, req.user);
    }

    // Log to audit trail
    await query(
      `INSERT INTO audit_log (user_id, user_email, customer_name, action, severity, details)
       VALUES ($1,$2,$3,'REPORT_GENERATED','info',$4)`,
      [req.user.id, req.user.email, data.customerName,
       JSON.stringify({ type, format, filename, title: formatReportTitle(type) })]
    );

    res.json({
      filename,
      download_url:  `/api/reports/download/${filename}`,
      generated_at:  new Date().toISOString(),
      title:         formatReportTitle(type),
      format,
      customer_name: data.customerName,
    });
  } catch (err) {
    logger.error("Report generation error:", err);
    res.status(500).json({ error: "Report generation failed: " + err.message });
  }
});

// ── GET /api/reports/download/:filename ───────────────────────────
// Uses short-lived one-time download tokens stored in Redis.
// Call POST /api/reports/request-download first to obtain a token.
// This avoids exposing the session JWT in URLs, access logs, and referrer headers.
router.post("/request-download", authenticate, async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: "filename is required" });

  const safeFilename = path.basename(filename);
  const filepath = path.join(REPORTS_DIR, safeFilename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "File not found" });

  // Generate a cryptographically random one-time token, valid for 60 seconds
  const crypto = require("crypto");
  const dlToken = crypto.randomBytes(24).toString("hex");
  const redisClient = require("../config/redis").getClient();
  if (redisClient) {
    await redisClient.set(`dl:${dlToken}`, safeFilename, "EX", 60).catch(() => {});
  }

  res.json({
    download_token: dlToken,
    download_url:   `/api/reports/download/${safeFilename}?dl_token=${dlToken}`,
    expires_in:     60,
  });
});

router.get("/download/:filename", async (req, res) => {
  const dlToken = req.query.dl_token;
  if (!dlToken) return res.status(401).json({ error: "Download token required" });

  const redisClient = require("../config/redis").getClient();
  if (!redisClient) return res.status(503).json({ error: "Download service unavailable" });

  // Consume the token — del returns 1 if found, 0 if not found/expired
  const filename = await redisClient.getdel(`dl:${dlToken}`).catch(() => null);
  if (!filename) return res.status(401).json({ error: "Invalid or expired download token" });

  const safeFilename = path.basename(filename);
  const filepath = path.join(REPORTS_DIR, safeFilename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "File not found" });
  res.download(filepath, safeFilename);
});

// ── GET /api/reports/history ───────────────────────────────────────
router.get("/history", authenticate, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, customer_name, details, created_at, user_email
      FROM audit_log
      WHERE action = 'REPORT_GENERATED'
      ORDER BY created_at DESC LIMIT 50
    `);
    res.json(rows.map(r => {
      const d = r.details || {};
      return {
        id:            r.id,
        title:         d.title || d.type || "Report",
        type:          d.type,
        format:        d.format || "pdf",
        filename:      d.filename,
        customer_name: r.customer_name,
        created_at:    r.created_at,
        generated_by:  r.user_email,
        download_url:  d.filename ? `/api/reports/download/${d.filename}` : null,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/customer-stats/:customerId ────────────────────
// Returns user-level stats derived from scan alerts for dashboard widgets
router.get("/customer-stats/:customerId", authenticate, async (req, res) => {
  try {
    const { rows: alerts } = await query(
      "SELECT severity, details FROM alerts WHERE customer_id=$1 AND is_acked=false",
      [req.params.customerId]
    );
    const findings = alerts.filter(a => a.details?.finding_id);
    const totalAffected = findings.reduce((s, a) => s + (a.details?.affected_count || 0), 0);
    const critical = alerts.filter(a => a.severity === "critical").length;
    const high     = alerts.filter(a => a.severity === "high").length;
    const medium   = alerts.filter(a => a.severity === "medium").length;
    const score    = Math.max(0, Math.min(100, 100 - critical*15 - high*5 - medium*2));
    res.json({ totalAffected, critical, high, medium, score, total: alerts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fetch real data from DB ────────────────────────────────────────
function filterFindingsForType(type, findings) {
  const id = (f) => String(f.finding_id || "").toUpperCase();
  const cat = (f) => String(f.category || "").toLowerCase();
  const title = (f) => String(f.title || "").toLowerCase();

  switch (type) {
    case "password_vulnerability":
      return findings.filter(f => id(f).startsWith("AD-PWD-") || cat(f) === "password");
    case "stale_accounts":
      return findings.filter(f => id(f).startsWith("AD-ACCT-") || /stale|inactive|never log/.test(title(f)) || cat(f) === "account");
    case "policy_compliance":
      return findings.filter(f => id(f).startsWith("AD-GPO-") || cat(f) === "gpo" || /policy/.test(title(f)));
    case "privileged_accounts":
      return findings.filter(f => id(f).startsWith("AD-PRIV-") || cat(f) === "privilege");
    case "compliance_mapping":
      return findings.filter(f => !!String(f.compliance || "").trim());
    case "kerberos_risks":
      return findings.filter(f => /kerberos|kerberoast|as-rep|ticket/.test(title(f)) || /KERB/.test(id(f)) || title(f).includes("as-rep"));
    case "trust_analysis":
      return findings.filter(f => id(f).startsWith("AD-TRUST-") || cat(f) === "trust");
    default:
      return findings;
  }
}

async function fetchReportData(type, customerId, customerName) {
  let customer = null;
  if (customerId) {
    const { rows } = await query("SELECT * FROM customers WHERE id=$1", [customerId]);
    customer = rows[0] || null;
  }

  const alertQ = customerId
    ? "SELECT * FROM alerts WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1000"
    : "SELECT * FROM alerts ORDER BY created_at DESC LIMIT 1000";
  const { rows: alerts } = await query(alertQ, customerId ? [customerId] : []);

  const allFindings = alerts
    .filter(a => a.details?.finding_id)
    .map(a => ({
      finding_id:  a.details.finding_id,
      title:       a.message,
      severity:    a.severity,
      category:    a.details.category     || "general",
      affected:    a.details.affected_count || 0,
      risk_score:  a.details.risk_score   || 0,
      remediation: a.details.remediation  || "",
      compliance:  a.details.compliance_summary || "",
      users_affected: (a.details.affected_users || []).join("; "),
      mitre:       (a.details.compliance?.mitre || []).map(m => m.id).join(", "),
      cis:         (a.details.compliance?.cis_v8      || []).join(", "),
      nist:        (a.details.compliance?.nist_800_53 || []).join(", "),
      iso:         (a.details.compliance?.iso_27001   || []).join(", "),
      soc2:        (a.details.compliance?.soc2        || []).join(", "),
    }));

  const findings = filterFindingsForType(type, allFindings);

  const critical = findings.filter(a => a.severity === "critical").length;
  const high     = findings.filter(a => a.severity === "high").length;
  const medium   = findings.filter(a => a.severity === "medium").length;
  const low      = findings.filter(a => a.severity === "low").length;
  const score    = Math.max(0, Math.min(100, 100 - critical*15 - high*5 - medium*2));

  const byCategory = findings.reduce((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});

  const base = {
    reportType:   type,
    customerName: customer?.name || customerName || "All Customers",
    domain:       customer?.domain || "—",
    generatedAt:  new Date().toISOString(),
    summary:      { totalAlerts: findings.length, critical, high, medium, low, securityScore: score, byCategory },
    findings,
  };

  if (type !== "ad_health_dashboard") return base;

  const userArgs = customerId ? [customerId] : [];
  const userWhere = customerId ? "WHERE customer_id=$1" : "";
  const { rows: userStats } = await query(
    `SELECT
       COUNT(*) AS total_users,
       COUNT(*) FILTER (WHERE is_enabled=true) AS enabled_users,
       COUNT(*) FILTER (WHERE is_enabled=false) AS disabled_users,
       COUNT(*) FILTER (WHERE password_expired=true) AS pwd_expired,
       COUNT(*) FILTER (WHERE password_never_expires=true) AS pwd_never_expires,
       COUNT(*) FILTER (WHERE last_logon IS NULL OR last_logon < NOW() - INTERVAL '90 days') AS inactive_90d,
       COUNT(*) FILTER (WHERE when_created >= NOW() - INTERVAL '7 days') AS recently_created
     FROM ad_users ${userWhere}`,
    userArgs
  );

  const invArgs = customerId ? [customerId] : [];
  const invWhere = customerId ? "WHERE customer_id=$1" : "";
  const { rows: inv } = await query(
    `SELECT
       COALESCE(SUM(computers_count),0) AS total_computers,
       COALESCE(SUM(gpos_count),0) AS total_gpos,
       COALESCE(SUM(ous_count),0) AS total_ous
     FROM (
       SELECT DISTINCT ON (customer_id) customer_id, users_count, groups_count, computers_count, ous_count, gpos_count
       FROM ad_inventory_snapshots
       ${invWhere}
       ORDER BY customer_id, started_at DESC
     ) latest`,
    invArgs
  );

  const dcArgs = customerId ? [customerId] : [];
  const dcWhere = customerId ? "WHERE s.customer_id = $1" : "";
  const { rows: domainControllers } = await query(
    `WITH latest AS (
       SELECT DISTINCT ON (s.customer_id) s.id, s.customer_id, s.customer_name, s.started_at
       FROM ad_inventory_snapshots s
       ${dcWhere}
       ORDER BY s.customer_id, s.started_at DESC
     )
     SELECT l.customer_name,
            o.object_key,
            o.attributes->>'dNSHostName' AS dns_host_name,
            o.attributes->>'operatingSystem' AS operating_system,
            o.attributes->>'ipv4Address' AS ipv4,
            o.attributes->>'isGlobalCatalog' AS is_gc,
            o.attributes->>'isReachable' AS is_reachable,
            o.attributes->>'fsmoRoles' AS fsmo_roles,
            o.distinguished_name,
            o.scanned_at
     FROM latest l
     JOIN ad_inventory_objects o ON o.snapshot_id = l.id
     WHERE o.object_type = 'computer'
     ORDER BY l.customer_name ASC, o.object_key ASC
     LIMIT 60`,
    dcArgs
  );

  const pgArgs = customerId ? [customerId] : [];
  const pgWhere = customerId ? "WHERE customer_id=$1" : "";
  const { rows: adminGroups } = await query(
    `SELECT member_of FROM ad_users ${pgWhere}`,
    pgArgs
  );
  const groupCounts = {};
  adminGroups.forEach((u) => {
    (u.member_of || []).forEach((g) => {
      const name = g.split(",")[0]?.replace("CN=", "") || g;
      groupCounts[name] = (groupCounts[name] || 0) + 1;
    });
  });
  const privilegedGroups = ["Domain Admins", "Enterprise Admins", "Schema Admins", "Administrators"].map(name => ({
    name,
    count: groupCounts[name] || 0,
  }));

  const replRows = allFindings
    .filter(f => String(f.category || "").toLowerCase() === "trust")
    .slice(0, 25)
    .map((f) => ({
      server: customer?.name || customerName || "N/A",
      partner: f.finding_id,
      last_sync: "N/A",
      consecutive_failures: f.affected || 0,
      status: ["critical", "high"].includes(f.severity) ? "Failed" : "Healthy",
    }));

  return {
    ...base,
    findings: type === "ad_health_dashboard" ? allFindings : findings,
    summary: type === "ad_health_dashboard"
      ? {
          ...base.summary,
          totalAlerts: allFindings.length,
          critical: allFindings.filter(a => a.severity === "critical").length,
          high: allFindings.filter(a => a.severity === "high").length,
          medium: allFindings.filter(a => a.severity === "medium").length,
          low: allFindings.filter(a => a.severity === "low").length,
        }
      : base.summary,
    health: {
      user_accounts: userStats[0] || {},
      infrastructure: inv[0] || {},
      domain_controllers: domainControllers,
      privileged_groups: privilegedGroups,
      replication: {
        healthy_partners: replRows.filter(r => r.status === "Healthy").length,
        failed_partners: replRows.filter(r => r.status === "Failed").length,
      },
      replication_rows: replRows,
      dns_zones: [{ zone_name: "Unable to retrieve", type: "N/A", dynamic_update: "N/A", status: "Error" }],
      findings_by_prefix: {
        gpo: allFindings.filter(f => f.finding_id?.startsWith("AD-GPO-")).length,
        trust: allFindings.filter(f => f.finding_id?.startsWith("AD-TRUST-")).length,
        dc: allFindings.filter(f => f.finding_id?.startsWith("AD-DC-")).length,
      },
    },
  };
}

// ── CSV ────────────────────────────────────────────────────────────
async function generateCSV(data, filepath, type) {
  let columns, records;
  const f = data.findings;

  if (type === "ad_health_dashboard") {
    const h = data.health || {};
    const users = h.user_accounts || {};
    const infra = h.infrastructure || {};
    const fx = h.findings_by_prefix || {};
    const dcs = Array.isArray(h.domain_controllers) ? h.domain_controllers : [];
    const pgs = Array.isArray(h.privileged_groups) ? h.privileged_groups : [];
    const repl = h.replication || {};
    const dns = Array.isArray(h.dns_zones) ? h.dns_zones : [];
    columns = ["Section", "Metric", "Value"];
    records = [
      ["Scope", "Customer", data.customerName],
      ["Scope", "Domain", data.domain],
      ["User Accounts", "Total Users", users.total_users || 0],
      ["User Accounts", "Enabled Users", users.enabled_users || 0],
      ["User Accounts", "Disabled Users", users.disabled_users || 0],
      ["User Accounts", "Password Expired", users.pwd_expired || 0],
      ["User Accounts", "Password Never Expires", users.pwd_never_expires || 0],
      ["User Accounts", "Inactive (90+ days)", users.inactive_90d || 0],
      ["User Accounts", "Recently Created (7 days)", users.recently_created || 0],
      ["Infrastructure", "Computer Objects", infra.total_computers || 0],
      ["Infrastructure", "Group Policy Objects", infra.total_gpos || 0],
      ["Infrastructure", "Organizational Units", infra.total_ous || 0],
      ["Infrastructure", "Domain Controller Objects", dcs.length],
      ["Findings", "GPO Findings", fx.gpo || 0],
      ["Findings", "Domain Controller Findings", fx.dc || 0],
      ["Findings", "Trust Findings", fx.trust || 0],
      ["Risk", "Security Score", data.summary?.securityScore || 0],
      ["Risk", "Critical", data.summary?.critical || 0],
      ["Risk", "High", data.summary?.high || 0],
      ["Risk", "Medium", data.summary?.medium || 0],
      ["Risk", "Low", data.summary?.low || 0],
      ["Replication", "Healthy Partners", repl.healthy_partners || 0],
      ["Replication", "Failed Partners", repl.failed_partners || 0],
    ];
    pgs.forEach((g) => records.push(["Privileged Groups", g.name, g.count || 0]));
    dcs.slice(0, 20).forEach((dc, idx) => {
      records.push(["Domain Controllers", `DC ${idx + 1}`, dc.object_key || dc.dns_host_name || "Unknown"]);
    });
    dns.slice(0, 10).forEach((z, idx) => {
      records.push(["DNS Zones", `Zone ${idx + 1}`, `${z.zone_name || "N/A"} (${z.status || "N/A"})`]);
    });
  } else if (type === "compliance_mapping") {
    columns = ["Finding ID","Title","Severity","CIS v8","NIST 800-53","ISO 27001","SOC 2","MITRE ATT&CK"];
    records = f.map(x => [x.finding_id, x.title, x.severity, x.cis, x.nist, x.iso, x.soc2, x.mitre]);
  } else if (type === "kerberos_risks") {
    const kf = f.filter(x => x.category === "privilege");
    columns = ["Finding ID","Title","Severity","Users Affected","Affected Count","Risk Score","Remediation"];
    records = kf.map(x => [x.finding_id, x.title, x.severity, x.users_affected, x.affected, x.risk_score, x.remediation]);
  } else if (type === "trust_analysis") {
    const tf = f.filter(x => x.category === "trust");
    columns = ["Finding ID","Title","Severity","Users Affected","Affected Count","Remediation"];
    records = tf.map(x => [x.finding_id, x.title, x.severity, x.users_affected, x.affected, x.remediation]);
  } else {
    columns = ["Finding ID","Title","Severity","Category","Users Affected","Affected Count","Risk Score","Compliance","Remediation"];
    records = f.map(x => [x.finding_id, x.title, x.severity, x.category, x.users_affected, x.affected, x.risk_score, x.compliance, x.remediation]);
  }

  if (!records.length) {
    records = [["—","No data — run a scan first","","","","","","",""]];
  }
  fs.writeFileSync(filepath, stringify([columns, ...records]), "utf8");
}

// ── PDF ────────────────────────────────────────────────────────────
async function generatePDF(data, filepath, type, customerName, user) {
  return new Promise((resolve, reject) => {
    // bufferPages:true is REQUIRED for switchToPage() footer to work
    const doc = new PDFDocument({ margin:50, size:"A4", bufferPages: true });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const BLUE  = "#0ea5e9";
    const DARK  = "#0a0e1a";
    const RED   = "#ef4444";
    const GREEN = "#22c55e";
    const AMBER = "#f59e0b";
    const GRAY  = "#64748b";
    const WHITE = "#e2e8f0";
    const s     = data.summary;

    if (type === "ad_health_dashboard") {
      const health = data.health || {};
      const users = health.user_accounts || {};
      const infra = health.infrastructure || {};
      const fx = health.findings_by_prefix || {};
      const dcs = Array.isArray(health.domain_controllers) ? health.domain_controllers : [];
      const pgs = Array.isArray(health.privileged_groups) ? health.privileged_groups : [];
      const repl = health.replication || {};
      const replRows = Array.isArray(health.replication_rows) ? health.replication_rows : [];
      const dnsZones = Array.isArray(health.dns_zones) ? health.dns_zones : [];

      doc.rect(0, 0, doc.page.width, 96).fill(DARK);
      doc.fillColor(BLUE).fontSize(20).font("Helvetica-Bold").text("Active Directory Health Dashboard", 50, 28);
      doc.fillColor(WHITE).fontSize(12).font("Helvetica").text(`${customerName} · ${data.domain}`, 50, 56);
      doc.fillColor(GRAY).fontSize(9).text(`Generated: ${new Date().toLocaleString()} · By: ${user.name}`, 50, 76);

      const cards = [
        ["User Accounts", users.total_users || 0, `${users.enabled_users || 0} enabled / ${users.disabled_users || 0} disabled`],
        ["Domain Controllers", dcs.length, "Latest inventory snapshot"],
        ["Group Policies", infra.total_gpos || 0, `${infra.total_ous || 0} OUs`],
        ["Replication", repl.healthy_partners || 0, `${repl.failed_partners || 0} failed`],
      ];
      let cx = 50;
      cards.forEach(([title, metric, sub]) => {
        doc.roundedRect(cx, 112, 120, 76, 6).fillAndStroke("#0f172a", "#1e293b");
        doc.fillColor(GRAY).fontSize(8).font("Helvetica-Bold").text(title, cx + 8, 122, { width: 104 });
        doc.fillColor(BLUE).fontSize(17).font("Helvetica-Bold").text(String(metric), cx + 8, 140, { width: 104 });
        doc.fillColor(WHITE).fontSize(7).font("Helvetica").text(String(sub), cx + 8, 163, { width: 104 });
        cx += 130;
      });

      let y = 210;
      doc.fillColor(WHITE).fontSize(12).font("Helvetica-Bold").text("Domain Controllers Status", 50, y);
      y += 16;
      doc.rect(50, y, 495, 15).fill("#1e3a8a");
      const headers = ["Controller", "Host", "OS", "Site"];
      const widths = [120, 130, 155, 90];
      let x = 54;
      headers.forEach((h, i) => {
        doc.fillColor(WHITE).fontSize(8).font("Helvetica-Bold").text(h, x, y + 4, { width: widths[i] });
        x += widths[i];
      });
      y += 17;

      dcs.slice(0, 14).forEach((dc, idx) => {
        if (y > 680) return;
        if (idx % 2 === 0) doc.rect(50, y, 495, 14).fill("#0b1220");
        const site = String(dc.distinguished_name || "").match(/CN=Servers,CN=([^,]+)/i)?.[1] || "N/A";
        const row = [dc.object_key || "—", dc.dns_host_name || "—", dc.operating_system || "—", site];
        x = 54;
        row.forEach((v, i) => {
          doc.fillColor(WHITE).fontSize(7).font("Helvetica").text(String(v), x, y + 3, { width: widths[i], ellipsis: true });
          x += widths[i];
        });
        y += 14;
      });

      y += 14;
      doc.fillColor(WHITE).fontSize(12).font("Helvetica-Bold").text("Replication Status", 50, y);
      y += 14;
      doc.rect(50, y, 495, 15).fill("#1e3a8a");
      const replHeaders = ["Server", "Partner", "Last Sync", "Consecutive Failures", "Status"];
      const replWidths = [84, 214, 80, 76, 41];
      x = 54;
      replHeaders.forEach((h, i) => {
        doc.fillColor(WHITE).fontSize(8).font("Helvetica-Bold").text(h, x, y + 4, { width: replWidths[i] });
        x += replWidths[i];
      });
      y += 17;
      const replOut = replRows.length ? replRows : [{ server: customerName || "N/A", partner: "N/A", last_sync: "Error", consecutive_failures: "N/A", status: "Error" }];
      replOut.slice(0, 6).forEach((r, idx) => {
        if (idx % 2 === 0) doc.rect(50, y, 495, 14).fill("#0b1220");
        const row = [r.server, r.partner, r.last_sync, String(r.consecutive_failures), r.status];
        x = 54;
        row.forEach((v, i) => {
          const col = i === 4 ? (String(v).toLowerCase() === "failed" || String(v).toLowerCase() === "error" ? RED : GREEN) : WHITE;
          doc.fillColor(col).fontSize(7).font(i === 4 ? "Helvetica-Bold" : "Helvetica").text(String(v), x, y + 3, { width: replWidths[i], ellipsis: true });
          x += replWidths[i];
        });
        y += 14;
      });

      y += 14;
      doc.fillColor(WHITE).fontSize(12).font("Helvetica-Bold").text("User Account Summary", 50, y);
      y += 14;
      [
        ["Password Expired", users.pwd_expired || 0],
        ["Password Never Expires", users.pwd_never_expires || 0],
        ["Inactive (90+ days)", users.inactive_90d || 0],
        ["Recently Created (7 days)", users.recently_created || 0],
        ["GPO Findings", fx.gpo || 0],
        ["DC Findings", fx.dc || 0],
        ["Trust Findings", fx.trust || 0],
      ].forEach(([k, v], idx) => {
        const ry = y + (idx * 13);
        doc.fillColor(idx % 2 ? GRAY : WHITE).fontSize(8.5).font("Helvetica").text(k, 54, ry, { width: 250 });
        doc.fillColor(BLUE).fontSize(8.5).font("Helvetica-Bold").text(String(v), 330, ry, { width: 80, align: "right" });
      });

      y += 102;
      doc.fillColor(WHITE).fontSize(12).font("Helvetica-Bold").text("DNS Zones", 50, y);
      y += 14;
      doc.rect(50, y, 495, 15).fill("#1e3a8a");
      const dnsHeaders = ["Zone Name", "Type", "Dynamic Update", "Status"];
      const dnsWidths = [180, 70, 160, 80];
      x = 54;
      dnsHeaders.forEach((h, i) => {
        doc.fillColor(WHITE).fontSize(8).font("Helvetica-Bold").text(h, x, y + 4, { width: dnsWidths[i] });
        x += dnsWidths[i];
      });
      y += 17;
      const dnsOut = dnsZones.length ? dnsZones : [{ zone_name: "Unable to retrieve", type: "N/A", dynamic_update: "N/A", status: "Error" }];
      dnsOut.slice(0, 4).forEach((z, idx) => {
        if (idx % 2 === 0) doc.rect(50, y, 495, 14).fill("#0b1220");
        const row = [z.zone_name, z.type, z.dynamic_update, z.status];
        x = 54;
        row.forEach((v, i) => {
          const col = i === 3 && String(v).toLowerCase() === "error" ? RED : WHITE;
          doc.fillColor(col).fontSize(7).font("Helvetica").text(String(v), x, y + 3, { width: dnsWidths[i], ellipsis: true });
          x += dnsWidths[i];
        });
        y += 14;
      });

      y += 14;
      doc.fillColor(WHITE).fontSize(12).font("Helvetica-Bold").text("Privileged Group Coverage", 50, y);
      y += 14;
      doc.rect(50, y, 495, 15).fill("#1e3a8a");
      doc.fillColor(WHITE).fontSize(8).font("Helvetica-Bold").text("Group", 54, y + 4, { width: 340 });
      doc.fillColor(WHITE).fontSize(8).font("Helvetica-Bold").text("Count", 420, y + 4, { width: 90 });
      y += 17;
      const pgOut = pgs.length ? pgs : [{ name: "Domain Admins", count: 0 }];
      pgOut.slice(0, 6).forEach((g, idx) => {
        if (idx % 2 === 0) doc.rect(50, y, 495, 14).fill("#0b1220");
        doc.fillColor(WHITE).fontSize(7).font("Helvetica").text(String(g.name || "N/A"), 54, y + 3, { width: 340, ellipsis: true });
        doc.fillColor(BLUE).fontSize(7).font("Helvetica-Bold").text(String(g.count || 0), 420, y + 3, { width: 90, align: "right" });
        y += 14;
      });

      doc.addPage();
      doc.rect(0, 0, doc.page.width, 54).fill(DARK);
      doc.fillColor(BLUE).fontSize(14).font("Helvetica-Bold").text("AD Findings Detail", 50, 18);
      doc.fillColor(GRAY).fontSize(9).text(`${data.findings.length} finding(s) sorted by severity`, 50, 38);

      const HDR = ["ID", "Title", "Severity", "Category", "Affected"];
      const COLW = [80, 230, 80, 80, 50];
      let ty = 68;
      doc.rect(44, ty - 5, doc.page.width - 88, 19).fill("#0f1629");
      x = 50;
      HDR.forEach((h, i) => {
        doc.fillColor(GRAY).fontSize(8).font("Helvetica-Bold").text(h, x, ty);
        x += COLW[i];
      });
      ty += 20;

      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const sevColor = { critical: RED, high: AMBER, medium: BLUE, low: GRAY };
      const sorted = [...data.findings].sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));
      sorted.forEach((f, idx) => {
        if (ty > 760) { doc.addPage(); ty = 50; }
        if (idx % 2 === 0) doc.rect(44, ty - 3, doc.page.width - 88, 16).fill("#050810");
        x = 50;
        [f.finding_id, f.title, f.severity.toUpperCase(), f.category, String(f.affected)].forEach((val, ci) => {
          doc.fillColor(ci === 2 ? (sevColor[f.severity] || WHITE) : WHITE)
            .fontSize(7.4)
            .font(ci === 2 ? "Helvetica-Bold" : "Helvetica")
            .text(String(val), x, ty, { width: COLW[ci] - 4, ellipsis: true });
          x += COLW[ci];
        });
        ty += 15;
      });

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.fillColor(GRAY).fontSize(8).font("Helvetica")
          .text(`ADSentinel Enterprise · AD Health Dashboard · Page ${i + 1} of ${range.count}`,
            50, doc.page.height - 28, { align: "center", width: doc.page.width - 100 });
      }

      doc.end();
      stream.on("finish", resolve);
      stream.on("error", reject);
      return;
    }

    // ── Page 1 header ──────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 96).fill(DARK);
    doc.fillColor(BLUE).fontSize(20).font("Helvetica-Bold").text("ADSentinel Enterprise", 50, 28);
    doc.fillColor(WHITE).fontSize(13).text(formatReportTitle(type), 50, 55);
    doc.fillColor(GRAY).fontSize(9).text(
      `Generated: ${new Date().toLocaleString()} · By: ${user.name}`, 50, 76
    );

    doc.rect(0, 96, doc.page.width, 34).fill("#0f1629");
    doc.fillColor(BLUE).fontSize(13).font("Helvetica-Bold")
       .text(`${customerName}  ·  ${data.domain}`, 50, 108);

    // ── Summary ────────────────────────────────────────────────────
    let y = 152;
    doc.fillColor(WHITE).fontSize(12).font("Helvetica-Bold").text("SUMMARY", 50, y);
    doc.moveTo(50, y+16).lineTo(doc.page.width-50, y+16).strokeColor(BLUE).lineWidth(1).stroke();
    y += 26;

    const sc = s.securityScore >= 80 ? GREEN : s.securityScore >= 60 ? AMBER : RED;
    [
      ["Security Score",    `${s.securityScore} / 100`, sc],
      ["Total Findings",    s.totalAlerts,              s.totalAlerts > 0 ? AMBER : GREEN],
      ["Critical",          s.critical,                 s.critical > 0   ? RED   : GREEN],
      ["High",              s.high,                     s.high > 0       ? AMBER : GREEN],
      ["Medium",            s.medium,                   WHITE],
      ["Low",               s.low,                      GRAY],
    ].forEach(([label, val, color]) => {
      doc.fillColor(GRAY).fontSize(10).font("Helvetica").text(label, 60, y);
      doc.fillColor(color).fontSize(10).font("Helvetica-Bold").text(String(val), 240, y);
      y += 19;
    });

    // Category breakdown
    if (Object.keys(s.byCategory).length) {
      y += 8;
      doc.fillColor(WHITE).fontSize(11).font("Helvetica-Bold").text("FINDINGS BY CATEGORY", 50, y);
      doc.moveTo(50, y+15).lineTo(doc.page.width-50, y+15).strokeColor(GRAY).lineWidth(0.5).stroke();
      y += 24;
      Object.entries(s.byCategory).forEach(([cat, count]) => {
        doc.fillColor(GRAY).fontSize(10).font("Helvetica")
           .text(cat.charAt(0).toUpperCase() + cat.slice(1), 60, y);
        doc.fillColor(WHITE).fontSize(10).font("Helvetica-Bold").text(String(count), 240, y);
        y += 17;
      });
    }

    // ── Page 2+: Findings ──────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 54).fill(DARK);
    doc.fillColor(BLUE).fontSize(14).font("Helvetica-Bold").text("FINDINGS DETAIL", 50, 18);
    doc.fillColor(GRAY).fontSize(9)
       .text(`${data.findings.length} finding(s) · sorted by risk`, 50, 38);

    const HDR  = ["ID","Title","Sev","Category","Affected","Risk"];
    const COLW = [80, 185, 55, 75, 55, 35];
    let ty     = 68;
    let xp;

    doc.rect(44, ty-5, doc.page.width-88, 19).fill("#0f1629");
    xp = 50;
    HDR.forEach((h, i) => {
      doc.fillColor(GRAY).fontSize(8).font("Helvetica-Bold").text(h, xp, ty);
      xp += COLW[i];
    });
    ty += 20;

    const SEV_C = { critical:RED, high:AMBER, medium:BLUE, low:GRAY };
    const sorted = [...data.findings].sort((a, b) => {
      const o = { critical:0, high:1, medium:2, low:3 };
      return (o[a.severity]||3) - (o[b.severity]||3);
    });

    sorted.forEach((f, idx) => {
      if (ty > 755) { doc.addPage(); ty = 50; }
      if (idx % 2 === 0) doc.rect(44, ty-3, doc.page.width-88, 16).fill("#050810");
      xp = 50;
      [f.finding_id, f.title, f.severity.toUpperCase(), f.category, String(f.affected), String(f.risk_score)]
        .forEach((val, ci) => {
          const color = ci === 2 ? (SEV_C[f.severity] || WHITE) : WHITE;
          doc.fillColor(color).fontSize(7.5)
             .font(ci === 2 ? "Helvetica-Bold" : "Helvetica")
             .text(val, xp, ty, { width: COLW[ci]-4, ellipsis: true });
          xp += COLW[ci];
        });
      ty += 15;

      if (f.remediation) {
        if (ty > 755) { doc.addPage(); ty = 50; }
        doc.fillColor(GRAY).fontSize(7).font("Helvetica-Oblique")
           .text(`  ↳ ${f.remediation}`, 55, ty, { width: doc.page.width-110, ellipsis: true });
        ty += 13;
      }
    });

    if (!sorted.length) {
      doc.fillColor(AMBER).fontSize(13).font("Helvetica-Bold").text("No findings available.", 50, 100);
      doc.fillColor(GRAY).fontSize(10).font("Helvetica")
         .text("Run a scan on this customer to populate findings.", 50, 122);
    }

    // ── Footer — MUST happen after all pages are added, BEFORE doc.end() ──
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fillColor(GRAY).fontSize(8).font("Helvetica")
         .text(
           `ADSentinel Enterprise · Confidential · Page ${i+1} of ${range.count}`,
           50, doc.page.height - 28,
           { align:"center", width: doc.page.width - 100 }
         );
    }

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

function formatReportTitle(type) {
  return ({
    executive_summary:     "Executive Summary Report",
    password_vulnerability: "Password Vulnerability Report",
    stale_accounts:         "Stale Account Report",
    policy_compliance:      "Policy Compliance Report",
    privileged_accounts:    "Privileged Account Audit",
    compliance_mapping:     "Compliance Mapping Report",
    kerberos_risks:         "Kerberos Attack Surface Report",
    trust_analysis:         "Trust Analysis Report",
    ad_health_dashboard:    "AD Health Dashboard Report",
    breach_exposure:        "Breach Exposure Report",
    full_audit:             "Full AD Audit Report",
  })[type] || type.replace(/_/g, " ");
}

module.exports = router;
