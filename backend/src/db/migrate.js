// backend/src/db/migrate.js
// Run once to create the schema:  node src/db/migrate.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SCHEMA = `
-- ──────────────────────────────────────────────────────────────
--  Syntrix — Synthetic Transaction Monitor
--  Database Schema v1
-- ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── flows ──────────────────────────────────────────────────────
-- A "flow" is a named business journey (e.g. "Login → Checkout")
-- that Syntrix continuously runs on a configurable interval.
CREATE TABLE IF NOT EXISTS flows (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT        NOT NULL,
  description  TEXT,
  type         TEXT        NOT NULL CHECK (type IN ('browser', 'api')),
  interval_s   INTEGER     NOT NULL DEFAULT 60,
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  tags         TEXT[]      DEFAULT '{}',
  -- runner-specific config: baseUrl, auth tokens, etc.
  config       JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── steps ──────────────────────────────────────────────────────
-- Each ordered step within a flow definition.
-- Browser steps: navigate / click / fill / assert*
-- API steps:     method + url + assertions + captureVar
CREATE TABLE IF NOT EXISTS steps (
  id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id          UUID    NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  name             TEXT    NOT NULL,
  description      TEXT,
  threshold_p95_ms INTEGER NOT NULL DEFAULT 1000,
  threshold_p99_ms INTEGER NOT NULL DEFAULT 2000,
  -- step-level runner config (action type + params)
  config           JSONB   NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(flow_id, position)
);

-- ── runs ───────────────────────────────────────────────────────
-- One record per complete execution of a flow.
CREATE TABLE IF NOT EXISTS runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id         UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('running','passed','failed','degraded')),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  failed_step_id  UUID REFERENCES steps(id),
  error           TEXT,
  meta            JSONB DEFAULT '{}'
);

-- ── step_results ───────────────────────────────────────────────
-- Per-step telemetry captured during each run.
CREATE TABLE IF NOT EXISTS step_results (
  id             UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id         UUID    NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id        UUID    NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  flow_id        UUID    NOT NULL,
  position       INTEGER NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('passed','failed','slow','skipped')),
  latency_ms     INTEGER,
  started_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  error          TEXT,
  screenshot     TEXT,   -- base64 PNG
  logs           TEXT[], -- ordered execution log lines
  http_status    INTEGER,
  response_body  TEXT,
  meta           JSONB DEFAULT '{}'
);

-- ── incidents ──────────────────────────────────────────────────
-- Raised when a flow fails/degrades; resolved when it recovers.
-- Drives the alert lifecycle (open → resolved).
CREATE TABLE IF NOT EXISTS incidents (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id             UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  failed_step_id      UUID REFERENCES steps(id),
  run_id              UUID REFERENCES runs(id),
  resolution_run_id   UUID REFERENCES runs(id),
  status              TEXT NOT NULL CHECK (status IN ('open','resolved')),
  severity            TEXT NOT NULL CHECK (severity IN ('critical','warning')),
  title               TEXT NOT NULL,
  description         TEXT,
  opened_at           TIMESTAMPTZ DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ,
  alert_sent_at       TIMESTAMPTZ,
  alert_channels      TEXT[] DEFAULT '{}'
);

-- ── metrics_hourly ─────────────────────────────────────────────
-- Pre-aggregated p50/p95/p99 per step per hour.
-- Written by the backend after each run; read by the chart API.
CREATE TABLE IF NOT EXISTS metrics_hourly (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id       UUID    NOT NULL,
  step_id       UUID    NOT NULL,
  hour          TIMESTAMPTZ NOT NULL,
  p50_ms        INTEGER,
  p95_ms        INTEGER,
  p99_ms        INTEGER,
  avg_ms        INTEGER,
  error_rate    NUMERIC(5,4) DEFAULT 0,
  sample_count  INTEGER DEFAULT 0,
  UNIQUE(step_id, hour)
);

-- ── indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_runs_flow_id       ON runs(flow_id);
CREATE INDEX IF NOT EXISTS idx_runs_started_at    ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_step_results_run   ON step_results(run_id);
CREATE INDEX IF NOT EXISTS idx_step_results_step  ON step_results(step_id);
CREATE INDEX IF NOT EXISTS idx_step_results_ts    ON step_results(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_flow     ON incidents(flow_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_metrics_step_hour  ON metrics_hourly(step_id, hour DESC);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('\n🗄  Running Syntrix migrations...');
    await client.query(SCHEMA);
    console.log('✅  Schema created / verified.\n');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
