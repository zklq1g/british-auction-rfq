const { withTransaction } = require('./db');
const { AppError } = require('./errors');
const { isInTriggerWindow, evaluateTrigger, computeNewCloseTime } = require('./auctionEngine');
const { parseBid } = require('./validators');

const fmt = (cents) => (cents / 100).toFixed(2);

async function getRanking(db, rfqId) {
  const { rows } = await db.query(
    `SELECT rk.supplier_id, u.name AS supplier_name, rk.total_price, rk.rank::int AS rank
       FROM rfq_supplier_ranks rk
       JOIN users u ON u.id = rk.supplier_id
      WHERE rk.rfq_id = $1
      ORDER BY rk.rank`,
    [rfqId]
  );
  return rows;
}

async function placeBid(rfqId, user, body) {
  const input = parseBid(body);

  return withTransaction(async (db) => {
    // 1. Lock the RFQ row. Concurrent bids on the same RFQ now run one at a time,
    //    so "before" and "after" rankings and the close-time update are consistent.
    const { rows: [rfq] } = await db.query('SELECT * FROM rfqs WHERE id = $1 FOR UPDATE', [rfqId]);
    if (!rfq) throw new AppError(404, 'RFQ not found');

    // clock_timestamp() (not now()) because now() is the transaction START time,
    // which could be stale if we waited on the lock.
    const { rows: [{ now }] } = await db.query('SELECT clock_timestamp() AS now');

    // 2. Is the auction open?
    if (now < rfq.bid_start_time) throw new AppError(409, 'Auction has not started yet');
    if (now >= rfq.bid_close_time) throw new AppError(409, 'Auction is closed');

    // 3. Ranking BEFORE this bid
    const before = await getRanking(db, rfqId);

    // 4. Reverse auction: a supplier must improve on their own previous best
    const mine = before.find((r) => String(r.supplier_id) === String(user.id));
    if (mine && input.totalCents >= Math.round(Number(mine.total_price) * 100)) {
      throw new AppError(
        400,
        `New total (${fmt(input.totalCents)}) must be lower than your current best (${Number(mine.total_price).toFixed(2)})`
      );
    }

    // 5. Insert the bid + log it using `now` acquired under the lock
    const { rows: [bid] } = await db.query(
      `INSERT INTO bids (rfq_id, supplier_id, carrier_name, freight_charges, origin_charges,
                         destination_charges, transit_time_days, quote_valid_until, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [rfqId, user.id, input.carrierName, input.freight, input.origin,
       input.destination, input.transitDays, input.validUntil, now]
    );

    await db.query(
      `INSERT INTO activity_logs (rfq_id, type, message, supplier_id, bid_id, metadata, created_at)
       VALUES ($1,'BID_PLACED',$2,$3,$4,$5,$6)`,
      [rfqId, `${user.name} placed a bid of ${fmt(input.totalCents)}`, user.id, bid.id,
       JSON.stringify({ total_price: bid.total_price }), now]
    );

    // 6. Ranking AFTER this bid
    const after = await getRanking(db, rfqId);

    // 7. Extension logic
    let extended = false;
    let closeTime = rfq.bid_close_time;

    if (isInTriggerWindow(now, rfq.bid_close_time, rfq.trigger_window_minutes)) {
      const { triggered, reason } = evaluateTrigger(rfq.extension_trigger, before, after);

      if (triggered) {
        const { newCloseTime, capped } = computeNewCloseTime(
          rfq.bid_close_time, rfq.forced_close_time, rfq.extension_minutes
        );

        if (newCloseTime > rfq.bid_close_time) {
          await db.query('UPDATE rfqs SET bid_close_time = $2 WHERE id = $1', [rfqId, newCloseTime]);

          await db.query(
            `INSERT INTO activity_logs (rfq_id, type, message, old_close_time, new_close_time, metadata, created_at)
             VALUES ($1,'TIME_EXTENDED',$2,$3,$4,$5,$6)`,
            [
              rfqId,
              `Close time extended: ${reason}` +
                (capped ? ' (capped at forced close time)' : ''),
              rfq.bid_close_time,
              newCloseTime,
              JSON.stringify({
                trigger: rfq.extension_trigger,
                capped,
                triggered_by_bid: bid.id,
                l1_before: before[0]?.supplier_id ?? null,
                l1_after: after[0]?.supplier_id ?? null,
              }),
              now,
            ]
          );
          extended = true;
          closeTime = newCloseTime;
        }
      }
    }

    const myRank = after.find((r) => String(r.supplier_id) === String(user.id))?.rank;
    return { bid, rank: myRank, extended, bid_close_time: closeTime };
  });
}

module.exports = { placeBid };
