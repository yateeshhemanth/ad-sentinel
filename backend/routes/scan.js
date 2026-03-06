const express = require("express");
const ldap    = require("ldapjs");
const dns     = require("dns").promises;
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


const WEAK_PASSWORDS = new Set([
  "password", "password123", "admin", "admin123", "welcome", "welcome123",
  "qwerty", "qwerty123", "letmein", "123456", "12345678", "123456789",
  "p@ssw0rd", "changeme", "iloveyou", "summer2024", "winter2024",
  "information", "information321", "welcome1", "password1", "admin1",
]);

const L33T = { "@":"a", "$":"s", "!":"i", "0":"o", "1":"i", "3":"e", "4":"a", "5":"s", "7":"t" };

function normalizePasswordVariant(input) {
  const p = String(input || "").trim().toLowerCase();
  const deLeet = p.replace(/[@$!013457]/g, (ch) => L33T[ch] || ch);
  return {
    raw: p,
    alphaNum: p.replace(/[^a-z0-9]/g, ""),
    deLeet,
    deLeetAlphaNum: deLeet.replace(/[^a-z0-9]/g, ""),
  };
}

function isExposedPassword(pwd) {
  const v = normalizePasswordVariant(pwd);
  const candidates = [v.raw, v.alphaNum, v.deLeet, v.deLeetAlphaNum];

  if (candidates.some((c) => WEAK_PASSWORDS.has(c))) return { ok: true, reason: "known_weak_list" };

  const weakRoots = ["password", "admin", "welcome", "letmein", "qwerty", "information", "changeme", "iloveyou"];
  if (candidates.some((c) => weakRoots.some((r) => c.startsWith(r) || c.endsWith(r)))) {
    return { ok: true, reason: "weak_dictionary_variant" };
  }

  return { ok: false, reason: "" };
}

function parsePasswordList(body) {
  if (Array.isArray(body.passwords)) return body.passwords.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof body.passwords_text === "string") return body.passwords_text.split(/[\r\n,;]+/).map(s => s.trim()).filter(Boolean);
  return [];
}

// ── POST /api/scan/password-list-scan ─────────────────────────────────
// Accepts uploaded/password-list text and returns weak/known-vulnerable matches.
router.post("/password-list-scan", authenticate, requireRole("admin", "engineer"), async (req, res) => {
  const items = parsePasswordList(req.body || {});
  if (!items.length) return res.status(400).json({ error: "Provide passwords[] or passwords_text" });

  const unique = [...new Set(items.map(p => p.trim()).filter(Boolean))];
  const matches = unique
    .map((p) => ({ password: p, result: isExposedPassword(p) }))
    .filter((x) => x.result.ok)
    .map((x) => ({ password: x.password, source: x.result.reason }));

  res.json({
    total_checked: unique.length,
    matched: matches.length,
    matches,
  });
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

  let targets = [{ host: dc_ip, port }];
  if (req.body.domain) {
    try {
      const records = await dns.resolveSrv(`_ldap._tcp.dc._msdcs.${req.body.domain}`);
      if (records?.length) {
        const hosts = [...new Set(records.map(r => String(r.name || "").replace(/\.$/, "")).filter(Boolean))];
        targets = hosts.map(h => ({ host: h, port }));
        steps.push(`ℹ️  Discovered ${hosts.length} domain controller(s) for ${req.body.domain}`);
      }
    } catch (e) {
      steps.push(`⚠️  DC discovery failed for ${req.body.domain}: ${e.message}. Using provided DC IP only.`);
    }
  }

  const results = [];
  for (const t of targets) {
    const client = ldap.createClient({
      url:            `${scheme}://${t.host}:${t.port}`,
      timeout:        10000,
      connectTimeout: 8000,
      reconnect:      false,
      tlsOptions,
    });

    try {
      await new Promise((resolve,reject)=> client.bind(bind_dn || "", password || "", (err)=> err ? reject(err) : resolve()));
      results.push({ target: `${t.host}:${t.port}`, ok: true });
      try { client.unbind(() => {}); } catch {}
    } catch (e) {
      results.push({ target: `${t.host}:${t.port}`, ok: false, message: e.message });
      try { client.unbind(() => {}); } catch {}
    }
  }

  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    return res.json({ ok: false, message: `Connection test failed on ${failed.length}/${results.length} domain controllers`, steps, dc_results: results });
  }

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
