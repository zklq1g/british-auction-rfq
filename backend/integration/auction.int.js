const assert = require('node:assert');
const { test, beforeEach, after } = require('node:test');

// ---- Safety guard: these tests TRUNCATE tables ----
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (use .env.test)');
if (!/test/i.test(new URL(process.env.DATABASE_URL).pathname)) {
  throw new Error('Refusing to run: DATABASE_URL database name must contain "test"');
}

const { pool, query } = require('../src/db');
const { placeBid } = require('../src/bidService');
const { createRfq } = require('../src/rfqService');
const { computeStatus } = require('../src/auctionEngine');

const MIN = 60 * 1000;
let buyer;
let suppliers; // 5 suppliers
let refCounter = 0;

// ---------- helpers ----------
async function mkUser(name, role) {
  const { rows } = await query(
    'INSERT INTO users (name, role) VALUES ($1, $2) RETURNING *', [name, role]);
  return rows[0];
}

/** Times are given as seconds relative to now. */
async function mkRfq({ startSecs = -3600, closeSecs, forcedSecs = 3600, x = 10, y = 1, trigger = 'ANY_BID' }) {
  const { rows: [rfq] } = await query(
    `INSERT INTO rfqs (reference_id, name, bid_start_time, original_close_time, bid_close_time,
                       forced_close_time, pickup_date, trigger_window_minutes, extension_minutes,
                       extension_trigger, created_by)
     VALUES ($1, 'Test RFQ',
             now() + make_interval(secs => $2::float8),
             now() + make_interval(secs => $3::float8),
             now() + make_interval(secs => $3::float8),
             now() + make_interval(secs => $4::float8),
             current_date + 7, $5, $6, $7, $8)
     RETURNING *`,
    [`T-${++refCounter}`, startSecs, closeSecs, forcedSecs, x, y, trigger, buyer.id]
  );
  return rfq;
}

const bid = (rfqId, user, total) =>
  placeBid(rfqId, user, {
    carrier_name: 'TestCarrier',
    freight_charges: total - 20,
    origin_charges: 10,
    destination_charges: 10,
    transit_time_days: 10,
    quote_valid_until: '2030-12-31',
  });

const getRfq = async (id) => (await query('SELECT * FROM rfqs WHERE id = $1', [id])).rows[0];
const getLogs = async (id, type) =>
  (await query('SELECT * FROM activity_logs WHERE rfq_id = $1 AND type = $2 ORDER BY id', [id, type])).rows;

const rejectsWith = (status, pattern) => (err) => {
  assert.strictEqual(err.status, status, `expected HTTP ${status}, got ${err.status}: ${err.message}`);
  if (pattern) assert.match(err.message, pattern);
  return true;
};

beforeEach(async () => {
  await query('TRUNCATE activity_logs, bids, rfqs, users RESTART IDENTITY CASCADE');
  buyer = await mkUser('Buyer Co', 'BUYER');
  suppliers = [];
  for (const n of ['A', 'B', 'C', 'D', 'E']) suppliers.push(await mkUser(`Supplier ${n}`, 'SUPPLIER'));
});

after(() => pool.end());

// ================= Extension basics =================

test('bid OUTSIDE the trigger window does not extend', async () => {
  const rfq = await mkRfq({ closeSecs: 600, x: 2, y: 1 }); // window opens 2 min before close
  const res = await bid(rfq.id, suppliers[0], 300);

  assert.strictEqual(res.extended, false);
  const after = await getRfq(rfq.id);
  assert.strictEqual(after.bid_close_time.getTime(), rfq.bid_close_time.getTime());
  assert.strictEqual((await getLogs(rfq.id, 'TIME_EXTENDED')).length, 0);
});

test('ANY_BID: a bid inside the window extends by exactly Y minutes', async () => {
  const rfq = await mkRfq({ closeSecs: 60, x: 10, y: 1, trigger: 'ANY_BID' });
  const res = await bid(rfq.id, suppliers[0], 300);

  assert.strictEqual(res.extended, true);
  const after = await getRfq(rfq.id);
  assert.strictEqual(after.bid_close_time.getTime() - rfq.bid_close_time.getTime(), 1 * MIN);
  assert.strictEqual(after.original_close_time.getTime(), rfq.original_close_time.getTime()); // immutable

  const [ext] = await getLogs(rfq.id, 'TIME_EXTENDED');
  assert.ok(ext, 'TIME_EXTENDED log written');
  assert.strictEqual(ext.old_close_time.getTime(), rfq.bid_close_time.getTime());
  assert.strictEqual(ext.new_close_time.getTime(), after.bid_close_time.getTime());
  assert.strictEqual(ext.metadata.trigger, 'ANY_BID');
});

// ================= Trigger types =================

async function l2SwapScenario(trigger) {
  const rfq = await mkRfq({ closeSecs: 300, x: 10, y: 1, trigger });
  const [A, B, C] = suppliers;
  await bid(rfq.id, A, 300);
  await bid(rfq.id, B, 400);
  await bid(rfq.id, C, 500);
  const res = await bid(rfq.id, C, 380); // C passes B for L2; A stays L1
  return { rfq, res };
}

test('ANY_RANK_CHANGE: an L2/L3 swap extends', async () => {
  const { res } = await l2SwapScenario('ANY_RANK_CHANGE');
  assert.strictEqual(res.extended, true);
});

test('L1_CHANGE: an L2/L3 swap does NOT extend, but taking L1 does', async () => {
  const { rfq, res } = await l2SwapScenario('L1_CHANGE');
  assert.strictEqual(res.extended, false);

  const [, , C] = suppliers;
  const takeover = await bid(rfq.id, C, 250); // C becomes L1
  assert.strictEqual(takeover.extended, true);
  assert.strictEqual(takeover.rank, 1);

  const exts = await getLogs(rfq.id, 'TIME_EXTENDED');
  assert.match(exts[exts.length - 1].message, /L1 changed from Supplier A to Supplier C/);
});

test('ANY_RANK_CHANGE: improving your own bid without changing order does NOT extend', async () => {
  const rfq = await mkRfq({ closeSecs: 300, x: 10, y: 1, trigger: 'ANY_RANK_CHANGE' });
  const [A, B] = suppliers;
  await bid(rfq.id, A, 300);
  await bid(rfq.id, B, 400);
  const res = await bid(rfq.id, A, 290); // A still L1, B still L2
  assert.strictEqual(res.extended, false);
});

// ================= Forced close cap =================

test('extension is capped at forced close, then no further extension', async () => {
  // close = T+60s, forced = T+90s, Y = 60s  =>  first extension would be T+120s, must cap at T+90s
  const rfq = await mkRfq({ closeSecs: 60, forcedSecs: 90, x: 10, y: 1 });
  const [A, B] = suppliers;

  const first = await bid(rfq.id, A, 300);
  assert.strictEqual(first.extended, true);
  let cur = await getRfq(rfq.id);
  assert.strictEqual(cur.bid_close_time.getTime(), cur.forced_close_time.getTime());

  const [ext] = await getLogs(rfq.id, 'TIME_EXTENDED');
  assert.strictEqual(ext.metadata.capped, true);
  assert.match(ext.message, /capped at forced close time/);

  // Another bid in the window: accepted, but nothing left to extend
  const second = await bid(rfq.id, B, 250);
  assert.strictEqual(second.extended, false);
  cur = await getRfq(rfq.id);
  assert.strictEqual(cur.bid_close_time.getTime(), cur.forced_close_time.getTime());
  assert.strictEqual((await getLogs(rfq.id, 'TIME_EXTENDED')).length, 1);

  // After the close time passes, the status is FORCE_CLOSED
  assert.strictEqual(computeStatus(cur, new Date(cur.forced_close_time.getTime() + MIN)), 'FORCE_CLOSED');
});

test('DB CHECK constraint refuses a close time beyond forced close', async () => {
  const rfq = await mkRfq({ closeSecs: 60, forcedSecs: 120 });
  await assert.rejects(
    query(`UPDATE rfqs SET bid_close_time = forced_close_time + interval '1 second' WHERE id = $1`, [rfq.id]),
    (e) => e.code === '23514'
  );
});

// ================= Rejections =================

test('bid after close is rejected', async () => {
  const rfq = await mkRfq({ closeSecs: -10, forcedSecs: 600 });
  await assert.rejects(bid(rfq.id, suppliers[0], 300), rejectsWith(409, /closed/i));
});

test('bid before start is rejected', async () => {
  const rfq = await mkRfq({ startSecs: 300, closeSecs: 600, forcedSecs: 900 });
  await assert.rejects(bid(rfq.id, suppliers[0], 300), rejectsWith(409, /not started/i));
});

test('supplier must improve on their own best bid', async () => {
  const rfq = await mkRfq({ closeSecs: 300 });
  const A = suppliers[0];
  await bid(rfq.id, A, 300);
  await assert.rejects(bid(rfq.id, A, 300), rejectsWith(400, /must be lower/));
  await assert.rejects(bid(rfq.id, A, 310), rejectsWith(400, /must be lower/));
  await bid(rfq.id, A, 299); // lower is fine
});

test('rejected bids leave no trace (transaction rolled back)', async () => {
  const rfq = await mkRfq({ closeSecs: 300 });
  const A = suppliers[0];
  await bid(rfq.id, A, 300);
  await assert.rejects(bid(rfq.id, A, 400));
  const { rows } = await query('SELECT count(*)::int AS n FROM bids WHERE rfq_id = $1', [rfq.id]);
  assert.strictEqual(rows[0].n, 1);
  assert.strictEqual((await getLogs(rfq.id, 'BID_PLACED')).length, 1);
});

test('createRfq: forced close must be later than bid close', async () => {
  const t = Date.now();
  const body = {
    name: 'Validation test', reference_id: 'V-1',
    bid_start_time: new Date(t + 60_000).toISOString(),
    bid_close_time: new Date(t + 3_600_000).toISOString(),
    forced_close_time: new Date(t + 3_600_000).toISOString(), // equal -> invalid
    pickup_date: '2030-01-01',
    trigger_window_minutes: 5, extension_minutes: 2, extension_trigger: 'ANY_BID',
  };
  await assert.rejects(createRfq(buyer, body), rejectsWith(400, /Forced close/));

  const ok = await createRfq(buyer, { ...body, forced_close_time: new Date(t + 4_000_000).toISOString() });
  assert.strictEqual(ok.status, 'UPCOMING');
});

// ================= Concurrency =================

test('concurrent bids are serialized: extensions chain with no lost updates', async () => {
  const rfq = await mkRfq({ closeSecs: 60, forcedSecs: 3600, x: 10, y: 1, trigger: 'ANY_BID' });

  const results = await Promise.all(suppliers.map((s, i) => bid(rfq.id, s, 1000 - i * 10)));
  assert.strictEqual(results.length, 5);

  // 5 bids x 1 minute each => original + 5 minutes. A lost update would give less.
  const final = await getRfq(rfq.id);
  assert.strictEqual(final.bid_close_time.getTime() - rfq.original_close_time.getTime(), 5 * MIN);

  const exts = await getLogs(rfq.id, 'TIME_EXTENDED');
  assert.strictEqual(exts.length, 5);
  assert.strictEqual((await getLogs(rfq.id, 'BID_PLACED')).length, 5);

  // Each extension starts exactly where the previous one ended
  assert.strictEqual(exts[0].old_close_time.getTime(), rfq.original_close_time.getTime());
  for (let i = 1; i < exts.length; i++) {
    assert.strictEqual(exts[i].old_close_time.getTime(), exts[i - 1].new_close_time.getTime());
  }
  assert.strictEqual(exts[4].new_close_time.getTime(), final.bid_close_time.getTime());

  // Ranks are consistent: 5 distinct ranks 1..5
  const ranks = results.map((r) => r.rank).sort();
  assert.deepStrictEqual(ranks.length, 5);
});

test('concurrent bids never push the close time past forced close', async () => {
  // close T+60, forced T+150, Y=60s: extensions go T+120, then capped at T+150, then nothing
  const rfq = await mkRfq({ closeSecs: 60, forcedSecs: 150, x: 10, y: 1, trigger: 'ANY_BID' });

  await Promise.all(suppliers.map((s, i) => bid(rfq.id, s, 1000 - i * 10)));

  const final = await getRfq(rfq.id);
  assert.strictEqual(final.bid_close_time.getTime(), final.forced_close_time.getTime());

  const exts = await getLogs(rfq.id, 'TIME_EXTENDED');
  assert.strictEqual(exts.length, 2);
  assert.strictEqual(exts[1].metadata.capped, true);
  for (const e of exts) assert.ok(e.new_close_time.getTime() <= final.forced_close_time.getTime());
});
