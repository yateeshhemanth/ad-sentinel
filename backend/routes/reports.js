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

  const critical = alerts.filter(a => a.severity === "critical").length;
  const high     = alerts.filter(a => a.severity === "high").length;
  const medium   = alerts.filter(a => a.severity === "medium").length;
  const low      = alerts.filter(a => a.severity === "low").length;
  const score    = Math.max(0, Math.min(100, 100 - critical*15 - high*5 - medium*2));

  const findings = alerts
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
      mitre:       (a.details.compliance?.mitre || []).map(m => m.id).join(", "),
      cis:         (a.details.compliance?.cis_v8      || []).join(", "),
      nist:        (a.details.compliance?.nist_800_53 || []).join(", "),
      iso:         (a.details.compliance?.iso_27001   || []).join(", "),
      soc2:        (a.details.compliance?.soc2        || []).join(", "),
    }));

  const byCategory = findings.reduce((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {});

  return {
    reportType:   type,
    customerName: customer?.name || customerName || "All Customers",
    domain:       customer?.domain || "—",
    generatedAt:  new Date().toISOString(),
    summary:      { totalAlerts: alerts.length, critical, high, medium, low, securityScore: score, byCategory },
    findings,
  };
}

// ── CSV ────────────────────────────────────────────────────────────
async function generateCSV(data, filepath, type) {
  let columns, records;
  const f = data.findings;

  if (type === "compliance_mapping") {
    columns = ["Finding ID","Title","Severity","CIS v8","NIST 800-53","ISO 27001","SOC 2","MITRE ATT&CK"];
    records = f.map(x => [x.finding_id, x.title, x.severity, x.cis, x.nist, x.iso, x.soc2, x.mitre]);
  } else if (type === "kerberos_risks") {
    const kf = f.filter(x => x.category === "privilege");
    columns = ["Finding ID","Title","Severity","Affected","Risk Score","Remediation"];
    records = kf.map(x => [x.finding_id, x.title, x.severity, x.affected, x.risk_score, x.remediation]);
  } else if (type === "trust_analysis") {
    const tf = f.filter(x => x.category === "trust");
    columns = ["Finding ID","Title","Severity","Affected","Remediation"];
    records = tf.map(x => [x.finding_id, x.title, x.severity, x.affected, x.remediation]);
  } else {
    columns = ["Finding ID","Title","Severity","Category","Affected","Risk Score","Compliance","Remediation"];
    records = f.map(x => [x.finding_id, x.title, x.severity, x.category, x.affected, x.risk_score, x.compliance, x.remediation]);
  }

  if (!records.length) {
    records = [["—","No data — run a scan first","","","","","",""]];
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
    breach_exposure:        "Breach Exposure Report",
    full_audit:             "Full AD Audit Report",
  })[type] || type.replace(/_/g, " ");
}

module.exports = router;
