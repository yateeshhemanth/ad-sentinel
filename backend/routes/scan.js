const express = require("express");
const ldap    = require("ldapjs");
const { authenticate, requireRole } = require("../middleware/auth");
const { runScan, getLibrary, reloadLibrary, getLibraryStats } = require("../services/scanEngine");
const { decrypt } = require("../config/crypto");
const logger = require("../config/logger");

const router = express.Router();

// ── Static routes FIRST ──────────────────────────────────────────────

router.get("/library/stats", authenticate, async (req, res) => {
  res.json(getLibraryStats());
});

router.get("/library", authenticate, async (req, res) => {
  try {
    const lib = getLibrary();
    const { category, severity } = req.query;
    let findings = lib.findings;
    if (category) findings = findings.filter(f => f.category === category);
    if (severity) findings = findings.filter(f => f.severity === severity);
    res.json({ version: lib.version, total: findings.length, findings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/library/reload", authenticate, requireRole("admin"), (req, res) => {
  const lib = reloadLibrary();
  res.json({ message: `Library reloaded — ${lib.findings.length} findings` });
});

// ── POST /api/scan/test-connection ───────────────────────────────────
// Real LDAP bind test — actually connects to the DC and attempts a bind.
// Accepts same fields as the connection form.
router.post("/test-connection", authenticate, async (req, res) => {
  const { dc_ip, ldap_port, bind_dn, bind_password, bind_password_enc } = req.body;

  if (!dc_ip) return res.status(400).json({ ok: false, message: "DC IP is required." });

  const port     = parseInt(ldap_port) || 389;
  const useTLS   = port === 636 || port === 3269;
  const scheme   = useTLS ? "ldaps" : "ldap";
  // Decrypt if this is an already-encrypted stored password
  const password = bind_password_enc ? (decrypt(bind_password_enc) || "") : (bind_password || "");

  // TLS options: rejectUnauthorized defaults to TRUE (secure).
  // Only set to false if the customer explicitly passes allow_self_signed: true
  // (exposed as a UI checkbox labelled "Trust self-signed certificate").
  const tlsOptions = useTLS
    ? { rejectUnauthorized: req.body.allow_self_signed !== true }
    : undefined;

  const steps = [];

  const client = ldap.createClient({
    url:            `${scheme}://${dc_ip}:${port}`,
    timeout:        10000,
    connectTimeout: 8000,
    tlsOptions,
    reconnect:      false,
  });

  let connectError = null;
  client.on("error", (err) => { connectError = err; });

  try {
    // Step 1: Bind (connect + authenticate in one call with ldapjs)
    await new Promise((resolve, reject) => {
      const dn  = bind_dn  || "";
      const pwd = password || "";
      client.bind(dn, pwd, (err) => {
        if (err) reject(err);
        else     resolve();
      });
    });

    steps.push(`✅ Connected to ${dc_ip}:${port}`);
    steps.push(bind_dn ? `✅ Bind successful as ${bind_dn}` : "✅ Anonymous bind successful");

    // Step 2: Quick search to verify read access
    try {
      await new Promise((resolve, reject) => {
        const base = req.body.domain
          ? req.body.domain.split(".").map(p => `DC=${p}`).join(",")
          : "DC=domain,DC=local";

        client.search(base, {
          filter:     "(objectClass=domainDNS)",
          scope:      "base",
          attributes: ["dc", "dnsRoot"],
          sizeLimit:  1,
        }, (err, searchRes) => {
          if (err) return reject(err);
          let found = false;
          searchRes.on("searchEntry", (e) => {
            found = true;
            const dc = e.attributes.find(a => a.type === "dnsRoot" || a.type === "dc");
            if (dc) steps.push(`✅ Domain read OK — ${dc.values[0]}`);
            else    steps.push("✅ Domain read OK");
          });
          searchRes.on("error",  (e) => reject(e));
          searchRes.on("end",    ()  => resolve(found));
        });
      });
    } catch (searchErr) {
      // Read failure is non-fatal for test — bind already succeeded
      steps.push(`⚠️  Bind OK but search failed: ${searchErr.message} (may need broader permissions)`);
    }

    try { client.unbind(() => {}); } catch {}
    return res.json({ ok: true, message: "Connection successful", steps });

  } catch (err) {
    try { client.unbind(() => {}); } catch {}

    // Translate to user-friendly message
    const msg = err.message || "";
    let friendly = msg;
    let hint     = "";

    if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET")) {
      friendly = `Cannot reach ${dc_ip}:${port}`;
      hint     = "Check that the DC IP is correct and port 389 is open from this server.";
    } else if (msg.includes("ETIMEDOUT") || msg.includes("ETIMED")) {
      friendly = `Connection timed out to ${dc_ip}:${port}`;
      hint     = "The DC may be unreachable from this host, or a firewall is blocking the connection.";
    } else if (err.code === 49 || msg.includes("Invalid Credentials") || msg.includes("80090308")) {
      friendly = `Invalid credentials for: ${bind_dn || "(anonymous)"}`;
      hint     = "Double-check the Bind DN format (e.g. CN=svc-audit,CN=Users,DC=domain,DC=local) and password.";
      steps.push(`✅ Connected to ${dc_ip}:${port}`);
      steps.push(`❌ Bind failed — wrong DN or password`);
    } else if (err.code === 50 || msg.includes("Insufficient Access")) {
      friendly = `Insufficient permissions for ${bind_dn}`;
      hint     = "The account needs read access to the directory. Add it to the built-in Readers group.";
      steps.push(`✅ Connected to ${dc_ip}:${port}`);
      steps.push(`✅ Bind OK — but insufficient read permissions`);
    } else if (msg.includes("certificate") || msg.includes("self signed")) {
      friendly = "TLS certificate error";
      hint     = "Use port 389 for standard LDAP, or trust the DC certificate on this server.";
    }

    logger.warn(`Test connection to ${dc_ip}:${port} failed: ${msg}`);
    return res.json({ ok: false, message: friendly, hint, steps, raw: msg });
  }
});

// ── POST /api/scan/:customerId ───────────────────────────────────────

router.post("/:customerId", authenticate, requireRole("engineer", "admin"), async (req, res) => {
  try {
    const result = await runScan(req.params.customerId);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error("Scan failed:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
