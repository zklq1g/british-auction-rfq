const test = require('node:test');
const assert = require('node:assert');
const { isInTriggerWindow, evaluateTrigger, computeNewCloseTime, computeStatus } = require('../src/auctionEngine');

const t = (hhmm) => new Date(`2030-01-01T${hhmm}:00Z`);
const r = (id, name, price) => ({ supplier_id: id, supplier_name: name, total_price: price });

test('trigger window boundaries', () => {
  assert.ok(isInTriggerWindow(t('17:55'), t('18:00'), 10));
  assert.ok(isInTriggerWindow(t('17:50'), t('18:00'), 10));   // inclusive start
  assert.ok(!isInTriggerWindow(t('17:49'), t('18:00'), 10));  // before window
  assert.ok(!isInTriggerWindow(t('18:00'), t('18:00'), 10));  // at close = too late
});

test('ANY_BID always triggers', () => {
  assert.ok(evaluateTrigger('ANY_BID', [], []).triggered);
});

test('ANY_RANK_CHANGE: swap triggers, same order does not', () => {
  const A = r(1, 'A', 100), B = r(2, 'B', 110);
  assert.ok(evaluateTrigger('ANY_RANK_CHANGE', [A, B], [r(2, 'B', 90), A]).triggered);
  assert.ok(!evaluateTrigger('ANY_RANK_CHANGE', [A, B], [r(1, 'A', 95), B]).triggered);
});

test('L1_CHANGE: only triggers when the leader changes', () => {
  const A = r(1, 'A', 100), B = r(2, 'B', 110), C = r(3, 'C', 120);
  // B overtakes C for L2 only -> L1 unchanged
  assert.ok(!evaluateTrigger('L1_CHANGE', [A, C, B], [A, B, C]).triggered);
  // B takes the lead
  assert.ok(evaluateTrigger('L1_CHANGE', [A, B], [r(2, 'B', 90), A]).triggered);
  // very first bid
  assert.ok(evaluateTrigger('L1_CHANGE', [], [A]).triggered);
});

test('extension is capped at forced close', () => {
  const ext = computeNewCloseTime(t('18:00'), t('18:12'), 5);
  assert.deepStrictEqual(ext.newCloseTime, t('18:05'));
  assert.strictEqual(ext.capped, false);

  const capped = computeNewCloseTime(t('18:10'), t('18:12'), 5);
  assert.deepStrictEqual(capped.newCloseTime, t('18:12'));
  assert.strictEqual(capped.capped, true);
});

test('status', () => {
  const rfq = { bid_start_time: t('10:00'), bid_close_time: t('18:00'), forced_close_time: t('19:00') };
  assert.strictEqual(computeStatus(rfq, t('09:00')), 'UPCOMING');
  assert.strictEqual(computeStatus(rfq, t('12:00')), 'ACTIVE');
  assert.strictEqual(computeStatus(rfq, t('18:30')), 'CLOSED');
  const forced = { ...rfq, bid_close_time: t('19:00') };
  assert.strictEqual(computeStatus(forced, t('19:30')), 'FORCE_CLOSED');
});
