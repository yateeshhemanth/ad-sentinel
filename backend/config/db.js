const { Pool } = require("pg");
const logger   = require("./logger");

// ── Fail-fast on missing required secrets ──────────────────────────────
// Never fall back to hard-coded passwords — a missing env var in prod
// must be an immediate, obvious error, not a silent credential downgrade.
const REQUIRED_VARS = ["DB_PASSWORD", "JWT_SECRET", "FIELD_ENCRYPTION_KEY"];
for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    // Use process.stderr so the message is visible even if the logger fails
    process.stderr.write(
      `[FATAL] Required environment variable "${v}" is not set. Refusing to start.\n`
    );
    process.exit(1);
  }
}

const pool = new Pool({
  host:     process.env.DB_HOST || "adsentinel-db",
  port:     parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "adsentinel",
  user:     process.env.DB_USER || "adsentinel",
  password: process.env.DB_PASSWORD,   // required — no fallback
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => logger.error("Unexpected DB pool error:", err));

// Retry with exponential backoff — handles startup race vs postgres
const connectDB = async (retries = 15, delayMs = 3000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      const { rows } = await client.query("SELECT NOW()");
      client.release();
      logger.info(`PostgreSQL connected (attempt ${attempt}): ${rows[0].now}`);
      await initSchema();
      return;
    } catch (err) {
      logger.warn(`DB connect attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) {
        logger.error("All DB connection attempts exhausted. Exiting.");
        process.exit(1);
      }
      const wait = Math.min(delayMs * attempt, 20000);
      await new Promise(r => setTimeout(r, wait));
    }
  }
};

const initSchema = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email            VARCHAR(255) UNIQUE NOT NULL,
        name             VARCHAR(255) NOT NULL,
        password_hash    VARCHAR(255) NOT NULL,
        role             VARCHAR(50)  NOT NULL DEFAULT 'analyst',
        is_active        BOOLEAN DEFAULT true,
        reset_token      VARCHAR(255),
        reset_token_expires TIMESTAMPTZ,
        last_login       TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customers (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name             VARCHAR(255) NOT NULL,
        domain           VARCHAR(255) NOT NULL,
        dc_ip            VARCHAR(255),
        ldap_port        INTEGER DEFAULT 389,
        bind_dn          TEXT,
        bind_password_enc TEXT,
        logo_path        VARCHAR(500),
        is_active        BOOLEAN DEFAULT true,
        last_scan        TIMESTAMPTZ,
        hr_status_url    TEXT,
        hr_status_token  TEXT,
        allow_self_signed BOOLEAN DEFAULT false,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id      UUID REFERENCES customers(id) ON DELETE CASCADE,
        customer_name    VARCHAR(255) NOT NULL,
        message          TEXT NOT NULL,
        severity         VARCHAR(50) NOT NULL,
        details          JSONB,
        is_acked         BOOLEAN DEFAULT false,
        acked_by         UUID REFERENCES users(id),
        acked_at         TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_no        VARCHAR(20) UNIQUE NOT NULL,
        title            VARCHAR(500) NOT NULL,
        description      TEXT,
        priority         VARCHAR(50) NOT NULL DEFAULT 'medium',
        status           VARCHAR(50) NOT NULL DEFAULT 'open',
        customer_id      UUID REFERENCES customers(id),
        customer_name    VARCHAR(255),
        alert_id         UUID REFERENCES alerts(id),
        assignee_id      UUID REFERENCES users(id),
        created_by       UUID REFERENCES users(id) NOT NULL,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW(),
        closed_at        TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS ticket_comments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id        UUID REFERENCES tickets(id) ON DELETE CASCADE,
        user_id          UUID REFERENCES users(id),
        user_name        VARCHAR(255),
        comment          TEXT NOT NULL,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID REFERENCES users(id),
        user_email       VARCHAR(255),
        customer_id      UUID,
        customer_name    VARCHAR(255),
        action           VARCHAR(255) NOT NULL,
        details          JSONB,
        ip_address       VARCHAR(45),
        severity         VARCHAR(50) DEFAULT 'info',
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ad_users (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id           UUID REFERENCES customers(id) ON DELETE CASCADE,
        customer_name         VARCHAR(255),
        sam_account_name      VARCHAR(255) NOT NULL,
        display_name          VARCHAR(255),
        email                 VARCHAR(255),
        department            VARCHAR(255),
        title                 VARCHAR(255),
        is_enabled            BOOLEAN DEFAULT true,
        is_admin              BOOLEAN DEFAULT false,
        password_never_expires BOOLEAN DEFAULT false,
        password_expired      BOOLEAN DEFAULT false,
        password_not_required BOOLEAN DEFAULT false,
        last_logon            TIMESTAMPTZ,
        pwd_last_set          TIMESTAMPTZ,
        when_created          TIMESTAMPTZ,
        member_of             JSONB DEFAULT '[]',
        distinguished_name    TEXT,
        raw_flags             INTEGER DEFAULT 0,
        scanned_at            TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(customer_id, sam_account_name)
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key              VARCHAR(255) PRIMARY KEY,
        value            TEXT,
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      );

      -- HR employee status cache (fetched from customer's hr_status_url)
      CREATE TABLE IF NOT EXISTS hr_employees (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id      UUID REFERENCES customers(id) ON DELETE CASCADE,
        employee_id      VARCHAR(255),
        name             VARCHAR(255),
        email            VARCHAR(255),
        department       VARCHAR(255),
        title            VARCHAR(255),
        status           VARCHAR(100) NOT NULL,
        termination_date DATE,
        manager          VARCHAR(255),
        raw              JSONB,
        fetched_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(customer_id, email)
      );
    `);
    await client.query("COMMIT");
    logger.info("Schema initialized");

    // Migrations — safe to run on existing DBs (ADD COLUMN IF NOT EXISTS)
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='hr_status_url') THEN
          ALTER TABLE customers ADD COLUMN hr_status_url TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='hr_status_token') THEN
          ALTER TABLE customers ADD COLUMN hr_status_token TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='allow_self_signed') THEN
          ALTER TABLE customers ADD COLUMN allow_self_signed BOOLEAN DEFAULT false;
        END IF;
      END $$;
    `).catch(e => logger.warn("Migration warning: " + e.message));

    // Seed / sync admin — UPSERT so password in .env always wins, even on existing DB
    const bcrypt     = require("bcryptjs");
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@adsentinel.local").toLowerCase().trim();
    const adminPass  =  process.env.ADMIN_PASSWORD;
    if (!adminPass) {
      throw new Error("ADMIN_PASSWORD environment variable is required. Set it in your .env file.");
    }
    const hash       = await bcrypt.hash(adminPass, 12);
    await pool.query(`
      INSERT INTO users (email, name, password_hash, role)
      VALUES ($1, $2, $3, 'admin')
      ON CONFLICT (email)
      DO UPDATE SET password_hash = EXCLUDED.password_hash,
                    role          = 'admin',
                    is_active     = true,
                    updated_at    = NOW()
    `, [adminEmail, "Administrator", hash]);
    logger.info(`Admin synced: ${adminEmail}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const query = (text, params) => pool.query(text, params);
module.exports = { connectDB, query, pool };
