// backend/src/routes/demo.js
// One-button demo mode for hackathon judges.
// POST /api/demo/scenario  →  triggers a scripted failure + recovery cycle
// The whole thing plays out in ~40 seconds live on the dashboard.

const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const ws        = require('../sockets');
const axios     = require('axios');

const BACKEND = `http://localhost:${process.env.PORT || 4000}`;

// ── POST /api/demo/scenario ───────────────────────────────────────────────
router.post('/scenario', async (req, res) => {
  const { flowId } = req.body;

  // Pick first enabled flow if none specified
  let targetFlow;
  if (flowId) {
    const { rows } = await query('SELECT * FROM flows WHERE id = $1', [flowId]);
    targetFlow = rows[0];
  } else {
    const { rows } = await query('SELECT * FROM flows WHERE enabled = true ORDER BY created_at LIMIT 1');
    targetFlow = rows[0];
  }

  if (!targetFlow) return res.status(404).json({ error: 'No flows found' });

  const { rows: steps } = await query(
    'SELECT * FROM steps WHERE flow_id = $1 ORDER BY position ASC', [targetFlow.id]
  );

  res.json({
    ok: true,
    message: `Demo scenario starting for "${targetFlow.name}" — watch the dashboard!`,
    flowId: targetFlow.id,
    timeline: [
      '0s  — Normal passing run submitted',
      '3s  — FAILURE injected at step 2 (simulated timeout)',
      '8s  — Incident created, Slack/email alerts fired',
      '20s — Second failure run (cooldown active, no re-alert)',
      '35s — Recovery run submitted, incident resolved',
    ],
  });

  // Run the scenario async — don't block the HTTP response
  runScenario(targetFlow, steps).catch(err =>
    console.error('[Demo] Scenario error:', err.message)
  );
});

// ── GET /api/demo/flows ───────────────────────────────────────────────────
// Returns flows for the demo selector dropdown
router.get('/flows', async (_req, res) => {
  const { rows } = await query('SELECT id, name, type FROM flows WHERE enabled = true ORDER BY created_at');
  res.json({ flows: rows });
});

// ── Scenario engine ───────────────────────────────────────────────────────
async function runScenario(flow, steps) {
  console.log(`\n[Demo] 🎬 Starting scenario for "${flow.name}"`);

  // ── Act 1: Healthy passing run ──────────────────────────────────────
  await sleep(500);
  console.log('[Demo] Act 1: Submitting healthy run...');
  await submitRun(flow, steps, 'passed', null);
  console.log('[Demo] ✅ Healthy run submitted');

  // ── Act 2: Failure injected ──────────────────────────────────────────
  await sleep(3000);
  console.log('[Demo] Act 2: Injecting failure at step 2...');
  await submitRun(flow, steps, 'failed', 2, {
    error: 'ConnectionTimeout: upstream service did not respond within 10000ms',
    httpStatus: 504,
  });
  console.log('[Demo] ❌ Failure run submitted — incident should open');

  // ── Act 3: Second failure (shows cooldown working) ───────────────────
  await sleep(12000);
  console.log('[Demo] Act 3: Second failure (testing cooldown)...');
  await submitRun(flow, steps, 'failed', 2, {
    error: 'ConnectionTimeout: upstream service did not respond within 10000ms',
    httpStatus: 504,
  });
  console.log('[Demo] ❌ Second failure submitted — cooldown should suppress alert');

  // ── Act 4: Recovery ──────────────────────────────────────────────────
  await sleep(15000);
  console.log('[Demo] Act 4: Service recovered — submitting passing run...');
  await submitRun(flow, steps, 'passed', null);
  console.log('[Demo] ✅ Recovery run submitted — incident should resolve');

  console.log('[Demo] 🎬 Scenario complete!\n');
}

async function submitRun(flow, steps, overallStatus, failAtStep, failInfo = {}) {
  const startedAt   = new Date();
  const stepResults = [];
  let   stepsFailed = false;

  for (const step of steps) {
    if (stepsFailed) {
      stepResults.push({
        position:    step.position,
        status:      'skipped',
        latencyMs:   null,
        startedAt:   new Date(),
        completedAt: new Date(),
        error:       'Skipped — previous step failed',
        logs:        ['[skipped] Previous step failed'],
      });
      continue;
    }

    if (failAtStep && step.position === failAtStep) {
      // Inject the failure
      stepResults.push({
        position:    step.position,
        status:      'failed',
        latencyMs:   9847,
        startedAt:   new Date(),
        completedAt: new Date(),
        error:       failInfo.error || 'Simulated failure',
        httpStatus:  failInfo.httpStatus || 500,
        logs: [
          `[${ts()}] → ${step.config?.method || 'GET'} ${step.config?.url || '/'}`,
          `[${ts()}] Waiting for response...`,
          `[${ts()}] ✗ FAILED: ${failInfo.error || 'Simulated failure'}`,
        ],
      });
      stepsFailed = true;
    } else {
      // Realistic latency with small jitter
      const base      = 150 + Math.random() * 300;
      const latencyMs = Math.round(base);
      stepResults.push({
        position:    step.position,
        status:      'passed',
        latencyMs,
        startedAt:   new Date(),
        completedAt: new Date(),
        httpStatus:  200,
        logs: [
          `[${ts()}] → ${step.config?.method || 'GET'} ${step.config?.url || '/'}`,
          `[${ts()}] ← HTTP 200 (${latencyMs}ms)`,
          `[${ts()}] ✓ Assertions passed`,
        ],
      });
    }
  }

  const completedAt = new Date();
  const durationMs  = completedAt - startedAt;

  try {
    await axios.post(`${BACKEND}/api/runs`, {
      flowId:    flow.id,
      status:    overallStatus,
      startedAt,
      completedAt,
      durationMs,
      stepResults,
    }, { timeout: 15000 });
  } catch (err) {
    console.error('[Demo] Run submission failed:', err.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ts() {
  return new Date().toISOString().split('T')[1].slice(0, 12);
}

module.exports = router;
