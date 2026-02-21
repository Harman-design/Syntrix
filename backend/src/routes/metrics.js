// backend/src/routes/metrics.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');

// ── GET /api/metrics/overview ─────────────────────────────────────────────
// Global dashboard stats card data
router.get('/overview', async (req, res) => {
  const [flows, runs24h, incidents, uptime7d, latency24h] = await Promise.all([
    // Per-flow latest status breakdown
    query(`
      SELECT
        COUNT(*)                                                           AS total,
        COUNT(*) FILTER (WHERE last_status = 'passed')                    AS passing,
        COUNT(*) FILTER (WHERE last_status = 'degraded')                  AS degraded,
        COUNT(*) FILTER (WHERE last_status IN ('failed','degraded'))       AS failing
      FROM (
        SELECT DISTINCT ON (flow_id) flow_id, status AS last_status
        FROM   runs
        ORDER  BY flow_id, started_at DESC
      ) t
    `),
    // Last 24h run counts
    query(`
      SELECT
        COUNT(*)                                               AS total,
        COUNT(*) FILTER (WHERE status = 'passed')             AS passed,
        COUNT(*) FILTER (WHERE status = 'failed')             AS failed,
        COUNT(*) FILTER (WHERE status = 'degraded')           AS degraded,
        ROUND(AVG(duration_ms))                               AS avg_duration_ms
      FROM runs
      WHERE started_at > NOW() - INTERVAL '24 hours'
    `),
    // Open incidents
    query(`SELECT COUNT(*) AS open FROM incidents WHERE status = 'open'`),
    // 7-day true flow uptime
    query(`
      SELECT ROUND(
        COUNT(*) FILTER (WHERE status = 'passed')::numeric /
        NULLIF(COUNT(*), 0) * 100, 2
      ) AS pct
      FROM runs
      WHERE started_at > NOW() - INTERVAL '7 days'
    `),
    // 24h overall p95 latency across all step_results
    query(`
      SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms
      FROM   step_results
      WHERE  started_at > NOW() - INTERVAL '24 hours'
        AND  status IN ('passed','slow')
    `),
  ]);

  res.json({
    flows:      flows.rows[0],
    runs24h:    runs24h.rows[0],
    incidents:  incidents.rows[0],
    uptime7d:   uptime7d.rows[0]?.pct,
    p95_ms:     latency24h.rows[0]?.p95_ms,
  });
});

// ── GET /api/metrics/flow/:flowId ─────────────────────────────────────────
// Per-step hourly p95/p99 data for charts, plus flow-level error rate
router.get('/flow/:flowId', async (req, res) => {
  const { flowId } = req.params;
  const hours = Math.min(168, parseInt(req.query.hours ?? '24'));  // max 7 days

  const { rows: steps } = await query(
    'SELECT * FROM steps WHERE flow_id = $1 ORDER BY position ASC', [flowId]
  );

  // Per-step hourly metrics
  const stepMetrics = await Promise.all(
    steps.map(async step => {
      const { rows: hourly } = await query(
        `SELECT hour, p50_ms, p95_ms, p99_ms, avg_ms, error_rate, sample_count
         FROM   metrics_hourly
         WHERE  step_id = $1
           AND  hour > NOW() - ($2 || ' hours')::INTERVAL
         ORDER  BY hour ASC`,
        [step.id, hours]
      );
      return { step, hourly };
    })
  );

  // Flow-level hourly run success/failure
  const { rows: flowHourly } = await query(
    `SELECT
       date_trunc('hour', started_at)                          AS hour,
       COUNT(*)                                                AS total,
       COUNT(*) FILTER (WHERE status = 'passed')              AS passed,
       COUNT(*) FILTER (WHERE status = 'failed')              AS failed,
       COUNT(*) FILTER (WHERE status = 'degraded')            AS degraded,
       ROUND(AVG(duration_ms))                                AS avg_duration_ms
     FROM   runs
     WHERE  flow_id = $1
       AND  started_at > NOW() - ($2 || ' hours')::INTERVAL
     GROUP  BY 1
     ORDER  BY 1 ASC`,
    [flowId, hours]
  );

  res.json({ stepMetrics, flowHourly });
});

module.exports = router;


// ─────────────────────────────────────────────────────────────────────────────
//  Incidents router (attached in index.js as /api/incidents)
// ─────────────────────────────────────────────────────────────────────────────
const incidentsRouter = express.Router();

// GET /api/incidents
incidentsRouter.get('/', async (req, res) => {
  const { status, flowId, limit = 50 } = req.query;
  const conds  = [];
  const params = [];
  let idx = 1;

  if (status) { conds.push(`i.status = $${idx++}`); params.push(status); }
  if (flowId) { conds.push(`i.flow_id = $${idx++}`); params.push(flowId); }

  params.push(parseInt(limit));

  const { rows } = await query(
    `SELECT i.*,
            f.name AS flow_name, f.type AS flow_type,
            s.name AS step_name, s.position AS step_position
     FROM   incidents i
     JOIN   flows f ON f.id = i.flow_id
     LEFT JOIN steps s ON s.id = i.failed_step_id
     ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
     ORDER  BY i.opened_at DESC
     LIMIT  $${idx}`,
    params
  );

  res.json({ incidents: rows });
});

// GET /api/incidents/:id
incidentsRouter.get('/:id', async (req, res) => {
  const { rows: [incident] } = await query(
    `SELECT i.*,
            f.name AS flow_name, f.type AS flow_type,
            s.name AS step_name, s.position AS step_position
     FROM   incidents i
     JOIN   flows f ON f.id = i.flow_id
     LEFT JOIN steps s ON s.id = i.failed_step_id
     WHERE  i.id = $1`,
    [req.params.id]
  );
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  let stepResults = [];
  if (incident.run_id) {
    const { rows } = await query(
      `SELECT sr.*, s.name AS step_name, s.position, s.threshold_p95_ms, s.threshold_p99_ms
       FROM   step_results sr
       JOIN   steps s ON s.id = sr.step_id
       WHERE  sr.run_id = $1
       ORDER  BY s.position ASC`,
      [incident.run_id]
    );
    stepResults = rows;
  }

  res.json({ incident, stepResults });
});

module.exports.incidentsRouter = incidentsRouter;
