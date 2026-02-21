// backend/src/db/pool.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});

pool.on('error', err => console.error('[DB] Unexpected pool error:', err.message));

// ── Query helper ──────────────────────────────────────────────────────────
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - start;
  if (ms > 500) console.warn(`[DB] Slow query (${ms}ms): ${text.slice(0, 80)}…`);
  return res;
}

// ── Transaction helper ────────────────────────────────────────────────────
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Percentile math ───────────────────────────────────────────────────────
// Takes a sorted array of numbers, returns the value at percentile p (0–100)
function percentileFromSorted(arr, p) {
  if (!arr.length) return null;
  const idx = Math.max(0, Math.ceil((p / 100) * arr.length) - 1);
  return arr[idx];
}

// Compute p50/p95/p99 from raw step_results over a time window
async function computePercentiles(stepId, windowHours = 24) {
  const { rows } = await query(
    `SELECT latency_ms
     FROM   step_results
     WHERE  step_id = $1
       AND  status  IN ('passed', 'slow')
       AND  started_at > NOW() - ($2 || ' hours')::INTERVAL
     ORDER  BY latency_ms ASC`,
    [stepId, windowHours]
  );

  const latencies = rows.map(r => r.latency_ms).filter(Boolean);
  return {
    p50:   percentileFromSorted(latencies, 50),
    p95:   percentileFromSorted(latencies, 95),
    p99:   percentileFromSorted(latencies, 99),
    avg:   latencies.length
             ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
             : null,
    count: latencies.length,
  };
}

// Roll up a single step's data into metrics_hourly (upsert)
async function aggregateHourlyMetrics(flowId, stepId) {
  const hour = new Date();
  hour.setMinutes(0, 0, 0);

  const { rows } = await query(
    `SELECT latency_ms, status
     FROM   step_results
     WHERE  step_id = $1
       AND  date_trunc('hour', started_at) = $2
     ORDER  BY latency_ms ASC`,
    [stepId, hour]
  );

  if (!rows.length) return;

  const latencies = rows.map(r => r.latency_ms).filter(Boolean).sort((a, b) => a - b);
  const failures  = rows.filter(r => r.status === 'failed').length;

  await query(
    `INSERT INTO metrics_hourly
       (flow_id, step_id, hour, p50_ms, p95_ms, p99_ms, avg_ms, error_rate, sample_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (step_id, hour) DO UPDATE SET
       p50_ms       = EXCLUDED.p50_ms,
       p95_ms       = EXCLUDED.p95_ms,
       p99_ms       = EXCLUDED.p99_ms,
       avg_ms       = EXCLUDED.avg_ms,
       error_rate   = EXCLUDED.error_rate,
       sample_count = EXCLUDED.sample_count`,
    [
      flowId, stepId, hour,
      percentileFromSorted(latencies, 50),
      percentileFromSorted(latencies, 95),
      percentileFromSorted(latencies, 99),
      latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null,
      rows.length ? failures / rows.length : 0,
      rows.length,
    ]
  );
}

module.exports = { pool, query, withTransaction, computePercentiles, aggregateHourlyMetrics };
