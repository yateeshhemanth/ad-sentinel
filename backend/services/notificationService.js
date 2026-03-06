const https = require("https");
const http = require("http");
const nodemailer = require("nodemailer");

const { query } = require("../config/db");
const logger = require("../config/logger");

function postJson(urlString, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlString);
      const lib = u.protocol === "https:" ? https : http;
      const body = JSON.stringify(payload);

      const req = lib.request({
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: 10000,
      }, (res) => {
        let data = "";
        res.on("data", (c) => data += c.toString("utf8"));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        });
      });

      req.on("timeout", () => { req.destroy(); reject(new Error("request timeout")); });
      req.on("error", reject);
      req.write(body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function loadNotificationConfig() {
  const { rows } = await query(
    "SELECT key, value FROM app_settings WHERE key IN ('alert_email','slack_webhook','webhook_url','pagerduty_routing_key')"
  );
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function sendEmail(alertEmail, summary, alerts) {
  if (!alertEmail) return;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const html = `
    <div style="font-family:sans-serif">
      <h3>ADSentinel Alert Notification</h3>
      <p><strong>Customer:</strong> ${summary.customer}</p>
      <p><strong>New Alerts:</strong> ${alerts.length}</p>
      <ul>
        ${alerts.slice(0, 20).map(a => `<li>[${a.finding_id}] ${a.title} (${a.severity}) — ${a.affected_count} affected</li>`).join("")}
      </ul>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: alertEmail,
    subject: `[ADSentinel] ${alerts.length} new alert(s) for ${summary.customer}`,
    html,
  });
}

async function sendSlack(webhook, summary, alerts) {
  if (!webhook) return;
  await postJson(webhook, {
    text: `🚨 ADSentinel: ${alerts.length} new alert(s) for ${summary.customer}`,
    attachments: alerts.slice(0, 10).map(a => ({
      color: a.severity === "critical" ? "#ef4444" : a.severity === "high" ? "#f59e0b" : "#0ea5e9",
      title: `[${a.finding_id}] ${a.title}`,
      text: `${a.affected_count} affected · severity ${a.severity}`,
    })),
  });
}

async function sendWebhook(webhook, summary, alerts) {
  if (!webhook) return;
  await postJson(webhook, {
    event: "adsentinel.alerts.created",
    timestamp: new Date().toISOString(),
    summary,
    alerts,
  });
}

async function sendPagerDuty(routingKey, summary, alerts) {
  if (!routingKey || !alerts.length) return;
  const top = alerts.find(a => a.severity === "critical") || alerts[0];
  await postJson("https://events.pagerduty.com/v2/enqueue", {
    routing_key: routingKey,
    event_action: "trigger",
    payload: {
      summary: `ADSentinel ${summary.customer}: ${alerts.length} new AD alert(s)` ,
      source: "adsentinel",
      severity: top.severity === "critical" ? "critical" : top.severity === "high" ? "error" : "warning",
      custom_details: { summary, top_alert: top, alerts: alerts.slice(0, 20) },
    },
  });
}

async function notifyNewAlerts(summary, alerts) {
  if (!alerts.length) return;
  try {
    const cfg = await loadNotificationConfig();
    const tasks = [
      sendEmail(cfg.alert_email, summary, alerts),
      sendSlack(cfg.slack_webhook, summary, alerts),
      sendWebhook(cfg.webhook_url, summary, alerts),
      sendPagerDuty(cfg.pagerduty_routing_key, summary, alerts),
    ];
    const results = await Promise.allSettled(tasks);
    results.forEach((r, idx) => {
      if (r.status === "rejected") {
        const name = ["email", "slack", "webhook", "pagerduty"][idx];
        logger.warn(`Alert notification (${name}) failed: ${r.reason?.message || r.reason}`);
      }
    });
  } catch (err) {
    logger.warn("Notification dispatch error: " + err.message);
  }
}

module.exports = { notifyNewAlerts };
