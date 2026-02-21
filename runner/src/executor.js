// runner/src/executor.js
// Fetches flow + step definitions from the backend,
// dispatches to the right runner (browser or API),
// then POSTs the complete results back.

require('dotenv').config();
const axios = require('axios');
const { runBrowserFlow } = require('./runners/browserRunner');
const { runApiFlow }     = require('./runners/apiRunner');

const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

async function runFlow(flow) {
  console.log(`\n[Executor] ▶ "${flow.name}" (${flow.type}, every ${flow.interval_s}s)`);
  const startedAt = new Date();

  // ── 1. Fetch step definitions ─────────────────────────────────────────
  let steps;
  try {
    const { data } = await axios.get(`${BACKEND}/api/flows/${flow.id}`, { timeout: 8000 });
    steps = data.steps;
  } catch (err) {
    console.error(`[Executor] Could not fetch steps for "${flow.name}": ${err.message}`);
    return;
  }

  if (!steps?.length) {
    console.warn(`[Executor] "${flow.name}" has no steps — skipping`);
    return;
  }

  // ── 2. Execute ───────────────────────────────────────────────────────
  let result;
  try {
    result = flow.type === 'browser'
      ? await runBrowserFlow(flow, steps)
      : await runApiFlow(flow, steps);
  } catch (err) {
    // Unexpected runner crash — still report it
    result = {
      status:      'failed',
      durationMs:  Date.now() - startedAt.getTime(),
      stepResults: [],
      error:       `Runner crash: ${err.message}`,
    };
    console.error(`[Executor] Runner crashed for "${flow.name}": ${err.message}`);
  }

  const completedAt = new Date();

  // ── 3. Log summary ────────────────────────────────────────────────────
  const icons = { passed: '✅', failed: '❌', degraded: '⚠️' };
  const stepSummary = result.stepResults
    .map(s => `${s.position}:${s.status === 'passed' ? '✓' : s.status === 'skipped' ? '–' : '✗'}`)
    .join(' ');

  console.log(
    `[Executor] ${icons[result.status] ?? '?'} "${flow.name}" → ` +
    `${result.status.toUpperCase()} (${result.durationMs}ms) | ${stepSummary}`
  );

  // ── 4. POST results to backend ────────────────────────────────────────
  try {
    await axios.post(
      `${BACKEND}/api/runs`,
      {
        flowId:      flow.id,
        status:      result.status,
        startedAt,
        completedAt,
        durationMs:  result.durationMs,
        stepResults: result.stepResults,
        error:       result.error ?? null,
      },
      {
        timeout:       60000,   // generous — screenshots are large
        maxBodyLength: 50 * 1024 * 1024,
        maxContentLength: 50 * 1024 * 1024,
      }
    );
    console.log(`[Executor] ✓ Results submitted for "${flow.name}"`);
  } catch (err) {
    console.error(`[Executor] Failed to submit results for "${flow.name}": ${err.message}`);
  }

  return result;
}

module.exports = { runFlow };
