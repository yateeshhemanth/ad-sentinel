require("dotenv").config();
const express    = require("express");
const helmet     = require("helmet");
const compression= require("compression");
const cors       = require("cors");
const morgan     = require("morgan");
const path       = require("path");

const logger        = require("./config/logger");
const { connectDB } = require("./config/db");
const { connectRedis } = require("./config/redis");

// ── Routes ──────────────────────────────────────────────────────────
const authRoutes      = require("./routes/auth");
const customerRoutes  = require("./routes/customers");
const alertRoutes     = require("./routes/alerts");
const ticketRoutes    = require("./routes/tickets");
const reportRoutes    = require("./routes/reports");
const settingsRoutes  = require("./routes/settings");
const logoRoutes      = require("./routes/logo");
const scanRoutes      = require("./routes/scan");
const auditLogRoutes  = require("./routes/auditLog");
const usersRoutes     = require("./routes/users");
const adUsersRoutes     = require("./routes/adUsers");
const offboardingRoutes  = require("./routes/offboarding");

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Trust nginx proxy ────────────────────────────────────────────────
// Required for express-rate-limit to read X-Forwarded-For correctly
// when running behind nginx. '1' = trust first proxy hop only.
app.set("trust proxy", 1);

// ── Security middleware ──────────────────────────────────────────────
// Helmet with a tuned Content-Security-Policy.
// Adjust script-src/style-src if you add CDN resources in future.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],   // inline styles used by React
      imgSrc:         ["'self'", "data:", "blob:"],    // data URIs for logos
      fontSrc:        ["'self'", "data:"],
      connectSrc:     ["'self'"],
      frameSrc:       ["'none'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: process.env.APP_ENV === "production" ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,  // not needed for this SPA architecture
}));
app.use(compression());
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman) and any localhost port in dev
    const allowed = process.env.FRONTEND_URL || "http://localhost";
    if (!origin || origin === allowed || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

// ── Request parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined", { stream: { write: msg => logger.info(msg.trim()) } }));

// ── Static uploads ───────────────────────────────────────────────────
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
const REPORTS_DIR_STATIC = path.join(__dirname, "reports");
const fs2 = require("fs");
if (!fs2.existsSync(REPORTS_DIR_STATIC)) fs2.mkdirSync(REPORTS_DIR_STATIC, { recursive: true });
app.use("/report-files", express.static(REPORTS_DIR_STATIC));

// ── Health check ─────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), version: "2.0.0" });
});

// ── API routes ────────────────────────────────────────────────────────
app.use("/api/auth",      authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/alerts",    alertRoutes);
app.use("/api/tickets",   ticketRoutes);
app.use("/api/reports",   reportRoutes);
app.use("/api/settings",  settingsRoutes);
app.use("/api/logo",      logoRoutes);
app.use("/api/scan",      scanRoutes);
app.use("/api/audit-log", auditLogRoutes);
app.use("/api/users",     usersRoutes);
app.use("/api/ad-users",     adUsersRoutes);
app.use("/api/offboarding",  offboardingRoutes);

// ── 404 handler ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

// ── Bootstrap ─────────────────────────────────────────────────────────
(async () => {
  await connectDB();
  await connectRedis();
  app.listen(PORT, () => {
    logger.info(`ADSentinel API running on port ${PORT}`);
  });
})();
