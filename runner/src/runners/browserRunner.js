// runner/src/runners/browserRunner.js
// Executes browser-based synthetic flows using Playwright Chromium.
//
// Supported step actions:
//   navigate    — { url }                          go to a URL, assert 2xx
//   click       — { selector }                     click an element
//   fill        — { selector, value }               type into an input
//   select      — { selector, value }               select a dropdown option
//   waitFor     — { selector, timeout? }            wait for element visible
//   waitForUrl  — { pattern }                       wait for URL to match
//   assertText  — { selector, text }                assert element contains text
//   assertUrl   — { pattern }                       assert current URL matches
//   assertVisible — { selector }                    assert element is visible
//   evaluate    — { script }                        run JS in page, throw if falsy
//   screenshot  — {}                                explicit screenshot step
//   hover       — { selector }                      hover over element
//   press       — { selector, key }                 keyboard press

const { chromium } = require('playwright');

async function runBrowserFlow(flow, steps) {
  const headless = process.env.BROWSER_HEADLESS !== 'false';
  const timeout  = parseInt(process.env.BROWSER_TIMEOUT_MS || '15000');

  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport:  { width: 1280, height: 800 },
    userAgent: 'Syntrix-Synthetic/1.0 Mozilla/5.0 (compatible)',
  });

  const page = await context.newPage();

  // Collect JS console errors automatically
  const jsErrors = [];
  page.on('console',   msg => { if (msg.type() === 'error') jsErrors.push(`[console] ${msg.text()}`); });
  page.on('pageerror', err => jsErrors.push(`[pageerror] ${err.message}`));

  const results      = [];
  const flowStart    = Date.now();
  let overallStatus  = 'passed';
  let skipRemaining  = false;

  for (const step of steps) {
    // ── Skipped ───────────────────────────────────────────────
    if (skipRemaining) {
      results.push(skippedResult(step.position));
      continue;
    }

    const logs      = [...jsErrors];  // include any JS errors up to this point
    const stepStart = Date.now();
    let   screenshot = null;

    try {
      const cfg    = step.config || {};
      const action = cfg.action || 'navigate';

      logs.push(`[${ts()}] Step ${step.position}: ${step.name} (${action})`);

      // ── Execute action ───────────────────────────────────────
      await executeAction(page, action, cfg, timeout, logs);

      const latencyMs = Date.now() - stepStart;
      logs.push(`[${ts()}] ✓ Completed in ${latencyMs}ms`);

      // Always capture screenshot (comment out to save memory)
      screenshot = await capture(page);

      // ── Threshold check ──────────────────────────────────────
      const stepStatus = latencyMs > step.threshold_p95_ms ? 'slow' : 'passed';
      if (stepStatus === 'slow' && overallStatus === 'passed') {
        overallStatus = 'degraded';
        logs.push(`  ⚠ Latency ${latencyMs}ms > p95 threshold ${step.threshold_p95_ms}ms`);
      }

      results.push({
        position:    step.position,
        status:      stepStatus,
        latencyMs,
        startedAt:   new Date(stepStart),
        completedAt: new Date(),
        screenshot,
        logs,
      });

    } catch (err) {
      const latencyMs = Date.now() - stepStart;
      logs.push(`[${ts()}] ✗ FAILED: ${err.message}`);
      console.error(`[BrowserRunner] Step ${step.position} "${step.name}" FAILED: ${err.message}`);

      // Always screenshot on failure for debugging
      screenshot = await capture(page).catch(() => null);

      results.push({
        position:    step.position,
        status:      'failed',
        latencyMs,
        startedAt:   new Date(stepStart),
        completedAt: new Date(),
        error:       err.message,
        screenshot,
        logs,
      });

      overallStatus = 'failed';
      skipRemaining = true;
    }
  }

  await browser.close();

  return {
    status:      overallStatus,
    durationMs:  Date.now() - flowStart,
    stepResults: results,
  };
}

// ── Action dispatcher ─────────────────────────────────────────────────────

async function executeAction(page, action, cfg, timeout, logs) {
  switch (action) {

    case 'navigate': {
      const url = cfg.url;
      if (!url) throw new Error('navigate action requires a url');
      logs.push(`  → GET ${url}`);
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout });
      if (!res) throw new Error(`Navigation to ${url} returned no response`);
      const status = res.status();
      logs.push(`  ← HTTP ${status}`);
      if (status >= 400) throw new Error(`HTTP ${status} loading ${url}`);
      break;
    }

    case 'click': {
      const sel = cfg.selector;
      logs.push(`  → Click "${sel}"`);
      await page.waitForSelector(sel, { state: 'visible', timeout });
      await page.click(sel);
      logs.push(`  ← Clicked`);
      break;
    }

    case 'fill': {
      logs.push(`  → Fill "${cfg.selector}" with "${String(cfg.value).slice(0, 40)}"`);
      await page.waitForSelector(cfg.selector, { state: 'visible', timeout });
      await page.fill(cfg.selector, cfg.value ?? '');
      logs.push(`  ← Filled`);
      break;
    }

    case 'select': {
      logs.push(`  → Select "${cfg.value}" in "${cfg.selector}"`);
      await page.waitForSelector(cfg.selector, { state: 'visible', timeout });
      await page.selectOption(cfg.selector, cfg.value);
      logs.push(`  ← Selected`);
      break;
    }

    case 'hover': {
      logs.push(`  → Hover "${cfg.selector}"`);
      await page.waitForSelector(cfg.selector, { state: 'visible', timeout });
      await page.hover(cfg.selector);
      logs.push(`  ← Hovered`);
      break;
    }

    case 'press': {
      logs.push(`  → Press "${cfg.key}" on "${cfg.selector}"`);
      await page.waitForSelector(cfg.selector, { state: 'visible', timeout });
      await page.press(cfg.selector, cfg.key);
      logs.push(`  ← Key pressed`);
      break;
    }

    case 'waitFor': {
      const t = cfg.timeout ?? timeout;
      logs.push(`  → Wait for "${cfg.selector}" (${t}ms)`);
      await page.waitForSelector(cfg.selector, { state: 'visible', timeout: t });
      logs.push(`  ← Visible`);
      break;
    }

    case 'waitForUrl': {
      logs.push(`  → Wait for URL: "${cfg.pattern}"`);
      await page.waitForURL(cfg.pattern, { timeout });
      logs.push(`  ← URL matched: ${page.url()}`);
      break;
    }

    case 'assertText': {
      logs.push(`  → Assert "${cfg.selector}" contains "${cfg.text}"`);
      await page.waitForSelector(cfg.selector, { state: 'visible', timeout });
      const el   = await page.$(cfg.selector);
      const text = await el.textContent();
      if (!text?.includes(cfg.text)) {
        throw new Error(`Expected "${cfg.text}" in "${cfg.selector}", got: "${text?.slice(0,200)}"`);
      }
      logs.push(`  ← Text assertion passed`);
      break;
    }

    case 'assertUrl': {
      const current = page.url();
      logs.push(`  → Assert URL matches "${cfg.pattern}" (current: ${current})`);
      const regex = new RegExp(cfg.pattern.replace(/\*/g, '.*'));
      if (!regex.test(current)) {
        throw new Error(`URL "${current}" does not match "${cfg.pattern}"`);
      }
      logs.push(`  ← URL matched`);
      break;
    }

    case 'assertVisible': {
      logs.push(`  → Assert "${cfg.selector}" is visible`);
      await page.waitForSelector(cfg.selector, { state: 'visible', timeout });
      logs.push(`  ← Visible`);
      break;
    }

    case 'evaluate': {
      logs.push(`  → Evaluate: ${cfg.script?.slice(0, 100)}`);
      const result = await page.evaluate(cfg.script);
      logs.push(`  ← Result: ${JSON.stringify(result)}`);
      if (result === false || result === null || result === undefined) {
        throw new Error(`evaluate returned falsy: ${JSON.stringify(result)}`);
      }
      break;
    }

    case 'screenshot': {
      logs.push(`  → Taking screenshot`);
      // screenshot is always captured in the parent — this is a no-op action
      logs.push(`  ← Screenshot captured`);
      break;
    }

    default:
      logs.push(`  ⚠ Unknown action "${action}" — skipping`);
  }
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
    screenshot:  null,
  };
}

async function capture(page) {
  try {
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    return buf.toString('base64');
  } catch {
    return null;
  }
}

module.exports = { runBrowserFlow };
