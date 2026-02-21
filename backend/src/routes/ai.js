// backend/src/routes/ai.js
// POST /api/ai/diagnose/:incidentId
// Sends the full incident context to Claude and streams back a diagnosis.

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { query } = require('../db/pool');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL         = 'claude-sonnet-4-20250514';

// ── POST /api/ai/diagnose/:incidentId ─────────────────────────────────────
router.post('/diagnose/:incidentId', async (req, res) => {
  const { incidentId } = req.params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(501).json({
      error: 'ANTHROPIC_API_KEY not set in backend/.env — add it to enable AI diagnosis'
    });
  }

  // ── 1. Fetch incident + step results ────────────────────────────────────
  const { rows: [incident] } = await query(
    `SELECT i.*, f.name AS flow_name, f.type AS flow_type, f.config AS flow_config,
            s.name AS failed_step_name, s.position AS failed_step_position
     FROM   incidents i
     JOIN   flows f ON f.id = i.flow_id
     LEFT JOIN steps s ON s.id = i.failed_step_id
     WHERE  i.id = $1`, [incidentId]
  );

  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  let stepResults = [];
  if (incident.run_id) {
    const { rows } = await query(
      `SELECT sr.*, s.name AS step_name, s.position,
              s.threshold_p95_ms, s.threshold_p99_ms, s.config AS step_config
       FROM   step_results sr
       JOIN   steps s ON s.id = sr.step_id
       WHERE  sr.run_id = $1
       ORDER  BY s.position ASC`, [incident.run_id]
    );
    stepResults = rows;
  }

  // ── 2. Build a rich prompt ───────────────────────────────────────────────
  const openSeconds = Math.round(
    (Date.now() - new Date(incident.opened_at).getTime()) / 1000
  );

  const prompt = `You are an expert SRE (Site Reliability Engineer) analyzing a production incident detected by Syntrix, a synthetic transaction monitoring system that runs real business flows end-to-end.

INCIDENT:
- Title: ${incident.title}
- Severity: ${incident.severity.toUpperCase()}
- Status: ${incident.status}
- Open for: ${openSeconds}s
- Flow: ${incident.flow_name} (${incident.flow_type})
- Base URL: ${incident.flow_config?.baseUrl || 'N/A'}

STEP-BY-STEP EXECUTION RESULTS:
${stepResults.map(sr => `
Step ${sr.position}: ${sr.step_name}
  Status:    ${sr.status.toUpperCase()}
  Latency:   ${sr.latency_ms ? `${sr.latency_ms}ms (p95 threshold: ${sr.threshold_p95_ms}ms)` : 'N/A'}
  HTTP:      ${sr.http_status || 'N/A'}
  Error:     ${sr.error || 'none'}
  Logs:      ${sr.logs?.join(' | ') || 'none'}
  Response:  ${sr.response_body ? sr.response_body.slice(0, 300) : 'N/A'}
`).join('')}

${incident.description ? `RAW ERROR:\n${incident.description}` : ''}

This is a synthetic test (no real user PII), but it accurately mirrors real user experience.

Respond ONLY with valid JSON matching this exact schema — no markdown, no explanation outside the JSON:
{
  "rootCause": "One clear technical sentence",
  "explanation": "2-3 sentences of technical detail",
  "likelyCulprits": ["culprit 1", "culprit 2", "culprit 3"],
  "immediateActions": ["action 1", "action 2", "action 3"],
  "preventionSteps": ["step 1", "step 2"],
  "severity": "P1|P2|P3",
  "blastRadius": "Which users/features are impacted right now",
  "estimatedFixTime": "e.g. 5-15 minutes",
  "shouldPage": true,
  "pageWho": "which team",
  "confidence": "high|medium|low"
}`;

  // ── 3. Call Claude ───────────────────────────────────────────────────────
  try {
    const { data } = await axios.post(
      ANTHROPIC_API,
      {
        model:      MODEL,
        max_tokens: 1000,
        messages:   [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 30000,
      }
    );

    const text = data.content?.[0]?.text || '';

    // Strip markdown fences if Claude wraps in ```json
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Try to extract JSON object from text
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Claude returned non-JSON response');
      parsed = JSON.parse(match[0]);
    }

    // Cache the diagnosis on the incident record (meta column)
    await query(
      `UPDATE incidents SET meta = COALESCE(meta, '{}') || $1 WHERE id = $2`,
      [JSON.stringify({ ai_diagnosis: parsed, ai_diagnosed_at: new Date() }), incidentId]
    ).catch(() => {});  // non-critical

    res.json({ diagnosis: parsed, incidentId, model: MODEL });

  } catch (err) {
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Invalid ANTHROPIC_API_KEY' });
    }
    if (err.response?.status === 429) {
      return res.status(429).json({ error: 'Claude API rate limit — try again in a moment' });
    }
    console.error('[AI] Diagnosis failed:', err.message);
    res.status(500).json({ error: `Claude API error: ${err.message}` });
  }
});

// ── GET /api/ai/diagnose/:incidentId ─────────────────────────────────────
// Returns cached diagnosis if it exists
router.get('/diagnose/:incidentId', async (req, res) => {
  const { rows: [incident] } = await query(
    'SELECT meta FROM incidents WHERE id = $1', [req.params.incidentId]
  );
  if (!incident) return res.status(404).json({ error: 'Not found' });

  const cached = incident.meta?.ai_diagnosis;
  if (cached) {
    return res.json({ diagnosis: cached, cached: true });
  }
  res.json({ diagnosis: null });
});

module.exports = router;
