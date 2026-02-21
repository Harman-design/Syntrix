// backend/src/routes/runs.js
const express = require('express');
const router  = express.Router();
const { query, aggregateHourlyMetrics } = require('../db/pool');
const { handleFailure, handleRecovery } = require('../services/alerts');
const ws = require('../sockets');

// ── POST /api/runs ─────────────────────────────────────────────────────────
// The runner calls this endpoint after completing a flow execution.
// Responsibilities:
//  1. Insert the run record
//  2. Insert per-step results (with screenshots, logs, latency)
//  3. Roll up hourly metrics for charting
//  4. Trigger alert lifecycle (failure / recovery)
//  5. Emit WebSocket events to connected dashboards
router.post('/', async (req, res) => {
  const { flowId, status, startedAt, completedAt, durationMs, stepResults, error } = req.body;

  if (!flowId || !status) {
    return res.status(400).json({ error: 'flowId and status are required' });
  }

  // ── 1. Insert run ────────────────────────────────────────────────────────
  const { rows: [run] } = await query(
    `INSERT INTO runs (flow_id, status, started_at, completed_at, duration_ms, error)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [flowId, status, startedAt ?? new Date(), completedAt ?? new Date(), durationMs, error]
  );

  // Fetch supporting context
  const { rows: [flow] } = await query('SELECT * FROM flows WHERE id = $1', [flowId]);
  const { rows: steps }  = await query(
    'SELECT * FROM steps WHERE flow_id = $1 ORDER BY position ASC', [flowId]
  );

  // ── 2. Insert step results ───────────────────────────────────────────────
  const insertedResults = [];
  if (stepResults?.length) {
    for (const sr of stepResults) {
      const step = steps.find(s => s.position === sr.position);
      if (!step) continue;

      const { rows: [result] } = await query(
        `INSERT INTO step_results
           (run_id, step_id, flow_id, position, status, latency_ms,
            started_at, completed_at, error, screenshot, logs, http_status, response_body)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          run.id, step.id, flowId, sr.position, sr.status, sr.latencyMs,
          sr.startedAt, sr.completedAt, sr.error,
          sr.screenshot, sr.logs ?? [],
          sr.httpStatus, sr.responseBody,
        ]
      );

      insertedResults.push({ ...result, step_id: step.id });

      // Emit per-step event for real-time step-by-step dashboard updates
      ws.stepCompleted(flowId, {
        run_id:     run.id,
        position:   sr.position,
        status:     sr.status,
        latency_ms: sr.latencyMs,
        error:      sr.error,
      });

      // ── 3. Aggregate hourly metrics ──────────────────────────────────────
      aggregateHourlyMetrics(flowId, step.id).catch(() => {});
    }
  }

  // Update run with failed_step_id if applicable
  const failedResult = insertedResults.find(r => r.status === 'failed');
  const slowResult   = insertedResults.find(r => r.status === 'slow');
  const problemResult = failedResult || slowResult;

  if (problemResult) {
    await query(
      'UPDATE runs SET failed_step_id = $1 WHERE id = $2',
      [problemResult.step_id, run.id]
    );
  }

  // ── 4. Alert lifecycle ───────────────────────────────────────────────────
  if (status === 'failed' || status === 'degraded') {
    const errorStep = problemResult
      ? { ...problemResult, step_id: problemResult.step_id }
      : null;

    handleFailure(run, flow, steps, errorStep).catch(err =>
      console.error('[Runs] Alert dispatch error:', err.message)
    );
  } else if (status === 'passed') {
    // Check if this flow was previously open — if so, resolve
    const { rows: open } = await query(
      'SELECT id FROM incidents WHERE flow_id = $1 AND status = $2 LIMIT 1',
      [flowId, 'open']
    );
    if (open.length > 0) {
      handleRecovery(flow, run).catch(err =>
        console.error('[Runs] Recovery dispatch error:', err.message)
      );
    }
  }

  // ── 5. WebSocket broadcast ───────────────────────────────────────────────
  ws.runCompleted(run, flow);

  // Broadcast updated global stats
  getGlobalStats().then(stats => ws.statsUpdated(stats)).catch(() => {});

  res.status(201).json({ run });
});

// ── GET /api/runs ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { flowId, limit = 50, offset = 0 } = req.query;

  const conditions = flowId ? 'WHERE r.flow_id = $1' : '';
  const params = flowId
    ? [flowId, parseInt(limit), parseInt(offset)]
    : [parseInt(limit), parseInt(offset)];

  const limitIdx  = flowId ? 2 : 1;
  const offsetIdx = flowId ? 3 : 2;

  const { rows } = await query(
    `SELECT r.*, f.name AS flow_name, f.type AS flow_type
     FROM   runs r
     JOIN   flows f ON f.id = r.flow_id
     ${conditions}
     ORDER  BY r.started_at DESC
     LIMIT  $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  res.json({ runs: rows });
});

// ── GET /api/runs/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { rows: [run] } = await query(
    `SELECT r.*, f.name AS flow_name, f.type AS flow_type
     FROM   runs r
     JOIN   flows f ON f.id = r.flow_id
     WHERE  r.id = $1`,
    [req.params.id]
  );
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const { rows: stepResults } = await query(
    `SELECT sr.*, s.name AS step_name, s.threshold_p95_ms, s.threshold_p99_ms
     FROM   step_results sr
     JOIN   steps s ON s.id = sr.step_id
     WHERE  sr.run_id = $1
     ORDER  BY sr.position ASC`,
    [req.params.id]
  );

  res.json({ run, stepResults });
});

// ── Helpers ───────────────────────────────────────────────────────────────
async function getGlobalStats() {
  const [flowsRes, incRes] = await Promise.all([
    query(`
      SELECT
        COUNT(*)                                                           AS total,
        COUNT(*) FILTER (WHERE last_status = 'passed')                    AS passing,
        COUNT(*) FILTER (WHERE last_status IN ('failed','degraded'))       AS failing
      FROM (
        SELECT DISTINCT ON (flow_id) flow_id, status AS last_status
        FROM runs ORDER BY flow_id, started_at DESC
      ) t
    `),
    query(`SELECT COUNT(*) AS open FROM incidents WHERE status = 'open'`),
  ]);

  return {
    flows:    flowsRes.rows[0],
    incidents: incRes.rows[0],
  };
}

module.exports = router;
