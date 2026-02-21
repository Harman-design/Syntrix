// runner/src/index.js
// Syntrix Runner — starts the HTTP server (for manual triggers)
// and the scheduler (for automatic flow execution).

require('dotenv').config();
require('express-async-errors');

const express   = require('express');
const axios     = require('axios');
const { start } = require('./scheduler');
const { runFlow } = require('./executor');

const app  = express();
app.use(express.json());

const PORT    = parseInt(process.env.RUNNER_PORT || '4001');
const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

// ── Auth middleware ────────────────────────────────────────────────────────
function requireSecret(req, res, next) {
  const secret = process.env.RUNNER_SECRET;
  if (secret && req.headers['x-runner-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized — wrong runner secret' });
  }
  next();
}

// ── POST /run — manually trigger a flow by ID ──────────────────────────────
// Called by the backend when a user clicks "Run Now" in the dashboard.
app.post('/run', requireSecret, async (req, res) => {
  const { flowId } = req.body;
  if (!flowId) return res.status(400).json({ error: 'flowId is required' });

  // Fetch the flow definition
  let flow;
  try {
    const { data } = await axios.get(`${BACKEND}/api/flows/${flowId}`, { timeout: 5000 });
    flow = data.flow;
  } catch (err) {
    return res.status(502).json({ error: `Could not fetch flow: ${err.message}` });
  }

  if (!flow) return res.status(404).json({ error: 'Flow not found' });

  // Respond immediately — run in background
  res.json({ ok: true, message: `"${flow.name}" queued for immediate execution` });

  // Fire and forget
  runFlow(flow).catch(err =>
    console.error(`[Runner] Manual trigger failed for "${flow.name}": ${err.message}`)
  );
});

// ── GET /health ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    service: 'syntrix-runner',
    ts:      new Date().toISOString(),
    backend: BACKEND,
  });
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Runner Error]', err.message);
  res.status(500).json({ error: err.message });
});

// ── Boot ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ⬡  Syntrix Runner
  ───────────────────────────────────
  HTTP  →  http://localhost:${PORT}
  Health   http://localhost:${PORT}/health
  Backend  ${BACKEND}
  ───────────────────────────────────`);

  // Start the flow scheduler
  start();
});
