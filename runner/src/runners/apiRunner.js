// runner/src/runners/apiRunner.js
// Executes API-based synthetic flows using Axios.
//
// Each step config supports:
//   method        — GET | POST | PUT | PATCH | DELETE
//   url           — full URL or path relative to flow's baseUrl
//   headers       — { key: value }
//   body          — request body for POST/PUT
//   params        — query string params
//   assertStatus  — expected HTTP status (default 200)
//   assertSchema  — { "fieldPath": "type" }  e.g. { "data.id": "number" }
//   assertFn      — JS expression string e.g. "data.length > 0"
//   captureVar    — { varName: "field.path" } — saves value for next steps
//   useVar        — reference captured vars in URL/body with {{varName}}

const axios = require('axios');

async function runApiFlow(flow, steps) {
  const baseUrl = flow.config?.baseUrl || '';
  const ctx     = {};  // shared context — captured vars live here
  const results = [];
  const flowStart = Date.now();
  let overallStatus  = 'passed';
  let skipRemaining  = false;

  for (const step of steps) {
    // ── Skipped step ──────────────────────────────────────────
    if (skipRemaining) {
      results.push(skippedResult(step.position));
      continue;
    }

    const logs     = [];
    const stepStart = Date.now();

    try {
      const cfg    = step.config || {};
      const method = (cfg.method || 'GET').toUpperCase();

      // Resolve URL: inject {{vars}} then prepend baseUrl if relative
      let url = cfg.url || '';
      if (!url.startsWith('http')) url = baseUrl + url;
      url = template(url, ctx);

      // Resolve body and headers with {{vars}}
      const headers = templateObj(cfg.headers || {}, ctx);
      const data    = cfg.body    ? templateObj(cfg.body, ctx)   : undefined;
      const params  = cfg.params  ? templateObj(cfg.params, ctx) : undefined;

      logs.push(`[${ts()}] → ${method} ${url}`);
      if (data) logs.push(`  Body: ${JSON.stringify(data).slice(0, 200)}`);

      // ── Make the request ────────────────────────────────────
      const response = await axios({
        method, url, headers, data, params,
        timeout:        cfg.timeout || 10000,
        validateStatus: () => true,   // handle status ourselves
      });

      const latencyMs = Date.now() - stepStart;
      logs.push(`  ← HTTP ${response.status} (${latencyMs}ms)`);

      // ── Assert status ───────────────────────────────────────
      const expectedStatus = cfg.assertStatus ?? 200;
      if (response.status !== expectedStatus) {
        const body = typeof response.data === 'string'
          ? response.data.slice(0, 300)
          : JSON.stringify(response.data).slice(0, 300);
        throw new Error(`HTTP ${response.status} (expected ${expectedStatus}): ${body}`);
      }

      // ── Assert schema ───────────────────────────────────────
      if (cfg.assertSchema) {
        assertSchema(response.data, cfg.assertSchema, logs);
      }

      // ── Assert custom function ──────────────────────────────
      if (cfg.assertFn) {
        const passed = runAssertion(cfg.assertFn, response.data, ctx);
        if (!passed) throw new Error(`Assertion failed: ${cfg.assertFn}`);
        logs.push(`  ✓ Assert: ${cfg.assertFn}`);
      }

      // ── Capture variable for next steps ─────────────────────
      if (cfg.captureVar) {
        for (const [varName, fieldPath] of Object.entries(cfg.captureVar)) {
          ctx[varName] = getPath(response.data, fieldPath);
          logs.push(`  ✓ Captured ctx.${varName} = ${JSON.stringify(ctx[varName])}`);
        }
      }

      // ── Latency threshold check ─────────────────────────────
      const stepStatus = latencyMs > step.threshold_p95_ms ? 'slow' : 'passed';
      if (stepStatus === 'slow') {
        if (overallStatus === 'passed') overallStatus = 'degraded';
        logs.push(`  ⚠ Latency ${latencyMs}ms exceeded p95 threshold ${step.threshold_p95_ms}ms`);
      }

      results.push({
        position:     step.position,
        status:       stepStatus,
        latencyMs,
        startedAt:    new Date(stepStart),
        completedAt:  new Date(),
        httpStatus:   response.status,
        responseBody: JSON.stringify(response.data).slice(0, 2000),
        logs,
      });

    } catch (err) {
      const latencyMs = Date.now() - stepStart;
      logs.push(`  ✗ FAILED: ${err.message}`);
      console.error(`[ApiRunner] Step ${step.position} "${step.name}" FAILED: ${err.message}`);

      results.push({
        position:    step.position,
        status:      'failed',
        latencyMs,
        startedAt:   new Date(stepStart),
        completedAt: new Date(),
        error:       err.message,
        logs,
      });

      overallStatus = 'failed';
      skipRemaining = true;
    }
  }

  return {
    status:      overallStatus,
    durationMs:  Date.now() - flowStart,
    stepResults: results,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString().split('T')[1].slice(0, 12);
}

function skippedResult(position) {
  return {
    position,
    status:      'skipped',
    latencyMs:   null,
    startedAt:   new Date(),
    completedAt: new Date(),
    error:       'Skipped — previous step failed',
    logs:        [],
  };
}

// Replace {{varName}} in a string with ctx values
function template(str, ctx) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? '');
}

// Apply template to every string value in an object
function templateObj(obj, ctx) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? template(v, ctx) : v;
  }
  return out;
}

// Dot-path accessor: getPath({a:{b:1}}, "a.b") → 1
function getPath(obj, path) {
  return path.split('.').reduce((acc, k) => acc?.[k], obj);
}

// Simple type schema check
function assertSchema(data, schema, logs) {
  for (const [field, expectedType] of Object.entries(schema)) {
    const val        = getPath(data, field);
    const actualType = Array.isArray(val) ? 'array' : typeof val;
    if (actualType !== expectedType) {
      throw new Error(
        `Schema: "${field}" expected ${expectedType}, got ${actualType} (value: ${JSON.stringify(val)})`
      );
    }
    logs.push(`  ✓ Schema: ${field} is ${actualType}`);
  }
}

// Run a JS assertion expression safely
function runAssertion(expr, data, ctx) {
  try {
    // eslint-disable-next-line no-new-func
    return new Function('data', 'ctx', `return !!(${expr})`)(data, ctx);
  } catch (e) {
    throw new Error(`Assertion expression error: ${e.message} in: ${expr}`);
  }
}

module.exports = { runApiFlow };
