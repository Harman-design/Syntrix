// backend/src/db/seed.js  (PATCHED — uses real APIs that always pass)
// Run:  node src/db/seed.js --reset   to wipe and re-seed

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    const reset = process.argv.includes('--reset');

    if (reset) {
      console.log('\n🗑  Wiping existing data...');
      await client.query('DELETE FROM incidents');
      await client.query('DELETE FROM step_results');
      await client.query('DELETE FROM runs');
      await client.query('DELETE FROM steps');
      await client.query('DELETE FROM flows');
      await client.query('DELETE FROM metrics_hourly');
      console.log('✓  Cleared.\n');
    } else {
      const { rows } = await client.query('SELECT COUNT(*) FROM flows');
      if (parseInt(rows[0].count) > 0) {
        console.log('⏭  Flows already exist — run with --reset to re-seed.');
        return;
      }
    }

    console.log('🌱  Seeding Syntrix demo flows (real APIs)...\n');

    // ── 1. GitHub API Health Check ───────────────────────────────────────
    // Uses GitHub's public API — no auth needed, always returns real data
    const { rows: [f1] } = await client.query(
      `INSERT INTO flows (name, description, type, interval_s, tags, config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        'GitHub API Health',
        'Validates GitHub REST API: auth check → fetch user → list repos → check rate limit',
        'api', 60,
        ['api', 'health', 'critical'],
        { baseUrl: 'https://api.github.com' },
      ]
    );
    await insertSteps(client, f1.id, [
      {
        n: 'GitHub API Reachable',
        d: 'GET /zen → 200, returns a zen quote string',
        p95: 800, p99: 1500,
        cfg: {
          method: 'GET', url: '/zen',
          headers: { 'User-Agent': 'Syntrix-Synthetic/1.0', 'Accept': 'application/vnd.github.v3+json' },
          assertStatus: 200,
        },
      },
      {
        n: 'Fetch Public User Profile',
        d: 'GET /users/octocat → 200, id + login fields present',
        p95: 800, p99: 1500,
        cfg: {
          method: 'GET', url: '/users/octocat',
          headers: { 'User-Agent': 'Syntrix-Synthetic/1.0' },
          assertStatus: 200,
          assertSchema: { id: 'number', login: 'string' },
          captureVar: { userId: 'id' },
        },
      },
      {
        n: 'List Public Repositories',
        d: 'GET /users/octocat/repos → 200, array with items',
        p95: 1000, p99: 2000,
        cfg: {
          method: 'GET', url: '/users/octocat/repos',
          headers: { 'User-Agent': 'Syntrix-Synthetic/1.0' },
          assertStatus: 200,
          assertFn: 'Array.isArray(data) && data.length > 0',
        },
      },
      {
        n: 'Check Rate Limit Headers',
        d: 'GET /rate_limit → 200, resources object present',
        p95: 600, p99: 1200,
        cfg: {
          method: 'GET', url: '/rate_limit',
          headers: { 'User-Agent': 'Syntrix-Synthetic/1.0' },
          assertStatus: 200,
          assertSchema: { resources: 'object' },
        },
      },
    ]);
    console.log('   ✓ GitHub API Health (api, 4 steps)');

    // ── 2. HTTPBin Request Validation ────────────────────────────────────
    // httpbin.org echoes back whatever you send — perfect for testing
    const { rows: [f2] } = await client.query(
      `INSERT INTO flows (name, description, type, interval_s, tags, config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        'Payment Gateway Simulation',
        'Simulates payment flow: create intent → validate → charge → confirm — using HTTPBin echo API',
        'api', 45,
        ['api', 'payments', 'critical'],
        { baseUrl: 'https://httpbin.org' },
      ]
    );
    await insertSteps(client, f2.id, [
      {
        n: 'Create Payment Intent',
        d: 'POST /post → 201 equiv, json.amount present in echo',
        p95: 1000, p99: 2000,
        cfg: {
          method: 'POST', url: '/post',
          body: { amount: 4999, currency: 'usd', customer_id: 'cus_synthetic_001' },
          assertStatus: 200,
          assertFn: 'data.json && data.json.amount === 4999',
          captureVar: { requestId: 'json.customer_id' },
        },
      },
      {
        n: 'Validate Card Token',
        d: 'POST /post with card token → echoed back correctly',
        p95: 800, p99: 1500,
        cfg: {
          method: 'POST', url: '/post',
          body: { token: 'tok_visa_synthetic', type: 'card' },
          assertStatus: 200,
          assertFn: 'data.json.token === "tok_visa_synthetic"',
        },
      },
      {
        n: 'Execute Charge',
        d: 'POST /post with charge data → charge_id in response',
        p95: 1500, p99: 3000,
        cfg: {
          method: 'POST', url: '/post',
          body: { amount: 4999, token: 'tok_visa_synthetic', description: 'Syntrix test charge' },
          assertStatus: 200,
          assertFn: 'data.json.amount === 4999 && typeof data.json.description === "string"',
        },
      },
      {
        n: 'Verify Response Headers',
        d: 'GET /headers → Content-Type header present',
        p95: 600, p99: 1200,
        cfg: {
          method: 'GET', url: '/headers',
          assertStatus: 200,
          assertSchema: { headers: 'object' },
        },
      },
    ]);
    console.log('   ✓ Payment Gateway Simulation (api, 4 steps)');

    // ── 3. REST Countries API ─────────────────────────────────────────────
    const { rows: [f3] } = await client.query(
      `INSERT INTO flows (name, description, type, interval_s, tags, config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        'User Data Service',
        'Validates user data pipeline: list → fetch → validate schema → assert fields',
        'api', 90,
        ['api', 'data'],
        { baseUrl: 'https://httpbin.org' },
      ]
    );
    await insertSteps(client, f3.id, [
      {
        n: 'Fetch User List',
        d: 'GET /get?type=users → 200, args object present',
        p95: 800, p99: 1500,
        cfg: {
          method: 'GET', url: '/get?type=users&page=1',
          assertStatus: 200,
          assertSchema: { args: 'object' },
        },
      },
      {
        n: 'Validate Query Params',
        d: 'GET /get?id=42 → args.id === "42"',
        p95: 600, p99: 1200,
        cfg: {
          method: 'GET', url: '/get?id=42&format=json',
          assertStatus: 200,
          assertFn: 'data.args && data.args.id === "42"',
        },
      },
      {
        n: 'Post User Data',
        d: 'POST /post with user payload → all fields echoed',
        p95: 800, p99: 1500,
        cfg: {
          method: 'POST', url: '/post',
          body: { userId: 42, name: 'Synthetic User', role: 'tester' },
          assertStatus: 200,
          assertFn: 'data.json.userId === 42 && data.json.role === "tester"',
        },
      },
    ]);
    console.log('   ✓ User Data Service (api, 3 steps)');

    // ── 4. End-to-End API Chain ───────────────────────────────────────────
    const { rows: [f4] } = await client.query(
      `INSERT INTO flows (name, description, type, interval_s, tags, config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        'Checkout Flow API',
        'Full checkout API chain: session → cart → apply discount → confirm order',
        'api', 120,
        ['api', 'revenue', 'critical'],
        { baseUrl: 'https://httpbin.org' },
      ]
    );
    await insertSteps(client, f4.id, [
      {
        n: 'Create Session',
        d: 'POST /post → session_id echoed back',
        p95: 800, p99: 1500,
        cfg: {
          method: 'POST', url: '/post',
          body: { session_id: 'sess_synthetic_abc123', user_id: 'usr_001' },
          assertStatus: 200,
          assertFn: 'data.json.session_id === "sess_synthetic_abc123"',
        },
      },
      {
        n: 'Add Item to Cart',
        d: 'POST /post with cart item → quantity + sku present',
        p95: 600, p99: 1200,
        cfg: {
          method: 'POST', url: '/post',
          body: { sku: 'WIDGET-001', quantity: 2, price: 29.99 },
          assertStatus: 200,
          assertFn: 'data.json.sku === "WIDGET-001" && data.json.quantity === 2',
        },
      },
      {
        n: 'Apply Discount Code',
        d: 'POST /post with coupon → discount echoed',
        p95: 500, p99: 1000,
        cfg: {
          method: 'POST', url: '/post',
          body: { coupon: 'SYNTRIX20', discount_pct: 20 },
          assertStatus: 200,
          assertFn: 'data.json.coupon === "SYNTRIX20"',
        },
      },
      {
        n: 'Confirm Order',
        d: 'POST /post with order → order_id in response',
        p95: 1000, p99: 2000,
        cfg: {
          method: 'POST', url: '/post',
          body: { order_total: 47.98, status: 'confirmed', items: 2 },
          assertStatus: 200,
          assertFn: 'data.json.status === "confirmed" && data.json.order_total === 47.98',
        },
      },
      {
        n: 'Send Confirmation Email',
        d: 'GET /get?action=email_sent → status echoed',
        p95: 400, p99: 800,
        cfg: {
          method: 'GET', url: '/get?action=email_sent&template=order_confirm',
          assertStatus: 200,
          assertFn: 'data.args.action === "email_sent"',
        },
      },
    ]);
    console.log('   ✓ Checkout Flow API (api, 5 steps)');

    console.log('\n✅  Seed complete — 4 real flows ready.\n');
    console.log('These flows use GitHub API + HTTPBin — both always available,');
    console.log('no auth required, reliable pass rate for demos.\n');

  } finally {
    client.release();
    await pool.end();
  }
}

async function insertSteps(client, flowId, steps) {
  for (const [i, s] of steps.entries()) {
    await client.query(
      `INSERT INTO steps (flow_id, position, name, description, threshold_p95_ms, threshold_p99_ms, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [flowId, i + 1, s.n, s.d, s.p95, s.p99, JSON.stringify(s.cfg)]
    );
  }
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
