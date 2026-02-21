// backend/src/db/seed.js
// Seeds 4 realistic demo flows so you can see Syntrix working immediately.
// Run after migrate:  node src/db/seed.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT COUNT(*) FROM flows');
    if (parseInt(rows[0].count) > 0) {
      console.log('⏭  Flows already exist — skipping seed.');
      return;
    }

    console.log('\n🌱  Seeding Syntrix demo flows...\n');

    // ── 1. Browser: Login → Checkout ────────────────────────────────────────
    const { rows: [f1] } = await client.query(
      `INSERT INTO flows (name, description, type, interval_s, tags, config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        'User Login → Checkout',
        'Full e-commerce browser journey: homepage → login → browse → add to cart → checkout',
        'browser', 60,
        ['critical', 'revenue'],
        { baseUrl: 'https://demo.playwright.dev/todomvc' },
      ]
    );
    await insertSteps(client, f1.id, [
      { n: 'Navigate to Homepage',  d: 'GET /  →  200 OK, title visible',              p95: 1000, p99: 2000, cfg: { action: 'navigate', url: 'https://demo.playwright.dev/todomvc' } },
      { n: 'Click Login Button',    d: 'Locate #login-btn and click',                  p95: 500,  p99: 1000, cfg: { action: 'click',    selector: '.new-todo' } },
      { n: 'Submit Credentials',    d: 'POST /api/auth  →  200 + JWT',                 p95: 800,  p99: 1500, cfg: { action: 'fill',     selector: '.new-todo', value: 'Syntrix test item' } },
      { n: 'Browse Product Page',   d: 'GET /products/featured  →  items rendered',    p95: 1000, p99: 2000, cfg: { action: 'waitFor',  selector: '.todo-list' } },
      { n: 'Add Item to Cart',      d: 'POST /api/cart  →  200 + cart incremented',    p95: 800,  p99: 1500, cfg: { action: 'assertText', selector: '.todo-list', text: 'Syntrix' } },
      { n: 'Proceed to Checkout',   d: 'GET /checkout  →  form visible, total shown',  p95: 1500, p99: 3000, cfg: { action: 'evaluate', script: 'document.querySelectorAll(".todo-list li").length > 0' } },
    ]);
    console.log('   ✓ User Login → Checkout (browser, 6 steps)');

    // ── 2. API: Product Search ───────────────────────────────────────────────
    const { rows: [f2] } = await client.query(
      `INSERT INTO flows (name, description, type, interval_s, tags, config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        'Product Search API',
        'API chain: auth → search → schema validate → assert results > 0',
        'api', 30,
        ['api', 'search'],
        { baseUrl: 'https://jsonplaceholder.typicode.com' },
      ]
    );
    await insertSteps(client, f2.id, [
      { n: 'Authenticate Service Account', d: 'GET /users/1  →  200, id field present',            p95: 500,  p99: 1000, cfg: { method: 'GET',  url: '/users/1',  assertStatus: 200, assertSchema: { id: 'number', name: 'string' }, captureVar: { userId: 'id' } } },
      { n: 'Execute Search Query',         d: 'GET /posts?userId={{userId}}  →  200, array',        p95: 800,  p99: 1500, cfg: { method: 'GET',  url: '/posts?userId={{userId}}', assertStatus: 200, assertFn: 'Array.isArray(data) && data.length > 0' } },
      { n: 'Validate Response Schema',     d: 'Each result has id, title, body fields',             p95: 100,  p99: 200,  cfg: { method: 'GET',  url: '/posts/1', assertStatus: 200, assertSchema: { id: 'number', title: 'string', body: 'string' } } },
      { n: 'Assert Result Count > 0',      d: 'GET /posts  →  array.length > 0',                   p95: 800,  p99: 1500, cfg: { method: 'GET',  url: '/posts', assertStatus: 200, assertFn: 'data.length > 0' } },
    ]);
    console.log('   ✓ Product Search API (api, 4 steps)');

    // ── 3. API: Payment Flow ─────────────────────────────────────────────────
    const { rows: [f3] } = await client.query(
      `INSERT INTO flows (name, description, type, interval_s, tags, config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        'Payment Processing',
        'Stripe-style API chain: intent → validate → charge → verify DB record',
        'api', 120,
        ['critical', 'payments'],
        { baseUrl: 'https://jsonplaceholder.typicode.com' },
      ]
    );
    await insertSteps(client, f3.id, [
      { n: 'Create Payment Intent',    d: 'POST /posts  →  201, id returned',          p95: 1000, p99: 2000, cfg: { method: 'POST', url: '/posts', body: { title: 'payment_intent', body: 'amount=4999', userId: 1 }, assertStatus: 201, assertSchema: { id: 'number' }, captureVar: { intentId: 'id' } } },
      { n: 'Validate Card Token',      d: 'GET /posts/{{intentId}}  →  200',            p95: 500,  p99: 1000, cfg: { method: 'GET',  url: '/posts/{{intentId}}', assertStatus: 200 } },
      { n: 'Charge Card (Test Mode)',  d: 'PUT /posts/{{intentId}}  →  200, charged',   p95: 2000, p99: 4000, cfg: { method: 'PUT',  url: '/posts/{{intentId}}', body: { title: 'charged', body: 'status=succeeded', userId: 1 }, assertStatus: 200 } },
      { n: 'Verify Transaction DB',    d: 'GET /posts/{{intentId}}  →  200, record',    p95: 200,  p99: 400,  cfg: { method: 'GET',  url: '/posts/{{intentId}}', assertStatus: 200, assertFn: 'data.id !== undefined' } },
    ]);
    console.log('   ✓ Payment Processing (api, 4 steps)');

    // ── 4. API: User Registration ────────────────────────────────────────────
    const { rows: [f4] } = await client.query(
      `INSERT INTO flows (name, description, type, interval_s, tags, config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        'Account Registration',
        'Register synthetic user → verify email record exists in DB',
        'api', 300,
        ['onboarding'],
        { baseUrl: 'https://jsonplaceholder.typicode.com' },
      ]
    );
    await insertSteps(client, f4.id, [
      { n: 'Submit Registration',     d: 'POST /users  →  201, userId returned',      p95: 1000, p99: 2000, cfg: { method: 'POST', url: '/users', body: { name: 'Syntrix Synthetic', email: 'synthetic@syntrix.io', username: 'syntrix_bot' }, assertStatus: 201, captureVar: { newUserId: 'id' } } },
      { n: 'Fetch Created User',      d: 'GET /users/{{newUserId}}  →  200',           p95: 500,  p99: 1000, cfg: { method: 'GET',  url: '/users/{{newUserId}}', assertStatus: 200 } },
      { n: 'Verify Email Field',      d: 'GET /users  →  email field is string',       p95: 800,  p99: 1500, cfg: { method: 'GET',  url: '/users/1', assertStatus: 200, assertSchema: { email: 'string' } } },
    ]);
    console.log('   ✓ Account Registration (api, 3 steps)');

    console.log('\n✅  Seed complete — 4 flows ready.\n');
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
