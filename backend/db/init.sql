-- Run by postgres on first init only (when data volume is empty)
-- Creates the DB and user if not already present

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'adsentinel') THEN
    CREATE USER adsentinel WITH PASSWORD 'dev_password_123';
  END IF;
END
$$;

SELECT 'CREATE DATABASE adsentinel OWNER adsentinel'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'adsentinel')\gexec

GRANT ALL PRIVILEGES ON DATABASE adsentinel TO adsentinel;
