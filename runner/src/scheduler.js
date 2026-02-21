// runner/src/scheduler.js
// Polls the backend every SCHEDULER_POLL_MS for the list of enabled flows.
// Tracks when each flow is next due and fires it in the background.
// Multiple flows can execute concurrently — one does not block another.

require('dotenv').config();
const axios     = require('axios');
const { runFlow } = require('./executor');

const BACKEND    = process.env.BACKEND_URL     || 'http://localhost:4000';
const POLL_MS    = parseInt(process.env.SCHEDULER_POLL_MS || '10000');

// nextRunAt[flowId] = timestamp (ms) when this flow should next execute
const nextRunAt = {};
// currently executing flow IDs (prevent double-running)
const running   = new Set();

async function fetchFlows() {
  try {
    const { data } = await axios.get(`${BACKEND}/api/flows`, { timeout: 5000 });
    return (data.flows || []).filter(f => f.enabled);
  } catch (err) {
    console.warn(`[Scheduler] Could not reach backend: ${err.message} — will retry`);
    return [];
  }
}

async function tick() {
  const flows = await fetchFlows();
  const now   = Date.now();

  for (const flow of flows) {
    if (running.has(flow.id)) continue;   // already in progress

    const due = nextRunAt[flow.id] ?? 0;  // 0 = run immediately on first tick
    if (now < due) continue;

    // Schedule the next run before launching, so a slow run doesn't delay the next one
    nextRunAt[flow.id] = now + flow.interval_s * 1000;

    // Launch in background — never await
    running.add(flow.id);
    runFlow(flow)
      .catch(err => console.error(`[Scheduler] Unhandled error in "${flow.name}":`, err.message))
      .finally(()  => running.delete(flow.id));
  }
}

function start() {
  console.log(`[Scheduler] Starting — polling backend every ${POLL_MS / 1000}s`);
  console.log(`[Scheduler] Backend: ${BACKEND}`);

  // Run first tick immediately, then on interval
  tick();
  setInterval(tick, POLL_MS);
}

module.exports = { start };
