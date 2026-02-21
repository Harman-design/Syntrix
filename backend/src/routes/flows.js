// backend/src/routes/flows.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { query, computePercentiles } = require('../db/pool');

// ── GET /api/flows ─────────────────────────────────────────────────────────
// List all flows enriched with latest run status, step count, pass rate.
router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT
      f.*,
      r.id           AS last_run_id,
      r.status       AS last_run_status,
      r.started_at   AS last_run_at,
      r.duration_ms  AS last_run_duration_ms,
      r.failed_step_id,
      (SELECT COUNT(*) FROM steps s WHERE s.flow_id = f.id)                AS step_count,
      (SELECT COUNT(*) FROM incidents i
       WHERE i.flow_id = f.id AND i.status = 'open')                       AS open_incidents,
      (SELECT ROUND(
        COUNT(*) FILTER (WHERE r2.status = 'passed')::numeric /
        NULLIF(COUNT(*),0) * 100, 1
       )
       FROM runs r2
       WHERE r2.flow_id = f.id
         AND r2.started_at > NOW() - INTERVAL '24 hours')                  AS pass_rate_24h
    FROM flows f
    LEFT JOIN LATERAL (
      SELECT * FROM runs WHERE flow_id = f.id ORDER BY started_at DESC LIMIT 1
    ) r ON true
    ORDER BY f.created_at ASC
  `);

  res.json({ flows: rows });
});

// ── GET /api/flows/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  const { rows: [flow] } = await query('SELECT * FROM flows WHERE id = $1', [id]);
  if (!flow) return res.status(404).json({ error: 'Flow not found' });

  const { rows: steps } = await query(
    'SELECT * FROM steps WHERE flow_id = $1 ORDER BY position ASC', [id]
  );

  const { rows: runs } = await query(
    'SELECT * FROM runs WHERE flow_id = $1 ORDER BY started_at DESC LIMIT 20', [id]
  );

  // Enrich steps with p95/p99 percentiles from last 24h of data
  const enrichedSteps = await Promise.all(
    steps.map(async step => ({
      ...step,
      percentiles: await computePercentiles(step.id, 24),
    }))
  );

  // Latest run's step-level results
  let latestStepResults = [];
  if (runs.length > 0) {
    const { rows } = await query(
      `SELECT sr.*, s.name AS step_name, s.position,
              s.threshold_p95_ms, s.threshold_p99_ms
       FROM   step_results sr
       JOIN   steps s ON s.id = sr.step_id
       WHERE  sr.run_id = $1
       ORDER  BY s.position ASC`,
      [runs[0].id]
    );
    latestStepResults = rows;
  }

  // Open + recent incidents
  const { rows: incidents } = await query(
    `SELECT i.*, s.name AS step_name, s.position AS step_position
     FROM   incidents i
     LEFT JOIN steps s ON s.id = i.failed_step_id
     WHERE  i.flow_id = $1
     ORDER  BY i.opened_at DESC
     LIMIT  10`,
    [id]
  );

  res.json({ flow, steps: enrichedSteps, runs, latestStepResults, incidents });
});

// ── POST /api/flows ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, description, type, interval_s, tags, config, steps } = req.body;

  if (!name)        return res.status(400).json({ error: 'name is required' });
  if (!type)        return res.status(400).json({ error: 'type is required (browser | api)' });
  if (!steps?.length) return res.status(400).json({ error: 'at least one step is required' });

  const { rows: [flow] } = await query(
    `INSERT INTO flows (name, description, type, interval_s, tags, config)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, description, type, interval_s ?? 60, tags ?? [], JSON.stringify(config ?? {})]
  );

  for (const [i, step] of steps.entries()) {
    await query(
      `INSERT INTO steps (flow_id, position, name, description, threshold_p95_ms, threshold_p99_ms, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        flow.id, i + 1, step.name, step.description ?? '',
        step.threshold_p95_ms ?? 1000,
        step.threshold_p99_ms ?? 2000,
        JSON.stringify(step.config ?? {}),
      ]
    );
  }

  console.log(`[Flows] Created "${flow.name}" (${flow.type})`);
  res.status(201).json({ flow });
});

// ── PATCH /api/flows/:id ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'description', 'interval_s', 'enabled', 'tags', 'config'];
  const updates = [];
  const values  = [];
  let idx = 1;

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      const val = field === 'config' ? JSON.stringify(req.body[field]) : req.body[field];
      updates.push(`${field} = $${idx++}`);
      values.push(val);
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const { rows: [flow] } = await query(
    `UPDATE flows SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  res.json({ flow });
});

// ── DELETE /api/flows/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  await query('DELETE FROM flows WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ── POST /api/flows/:id/trigger ───────────────────────────────────────────
// Manually trigger a flow run by proxying to the runner service.
router.post('/:id/trigger', async (req, res) => {
  const { id } = req.params;

  const { rows: [flow] } = await query('SELECT * FROM flows WHERE id = $1', [id]);
  if (!flow) return res.status(404).json({ error: 'Flow not found' });

  const runnerUrl = process.env.RUNNER_URL || 'http://localhost:4001';

  try {
    const { data } = await axios.post(
      `${runnerUrl}/run`,
      { flowId: id },
      {
        headers: { 'x-runner-secret': process.env.RUNNER_SECRET || '' },
        timeout: 10000,
      }
    );
    res.json({ ok: true, message: `"${flow.name}" queued`, ...data });
  } catch (err) {
    res.status(502).json({
      error: `Runner not reachable at ${runnerUrl} — is it running?`,
      detail: err.message,
    });
  }
});

module.exports = router;
