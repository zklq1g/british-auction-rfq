const { query, withTransaction } = require('./db');
const { AppError } = require('./errors');
const { computeStatus } = require('./auctionEngine');
const { parseCreateRfq } = require('./validators');

async function createRfq(user, body) {
  const v = parseCreateRfq(body);

  return withTransaction(async (db) => {
    let rfq;
    try {
      const { rows } = await db.query(
        `INSERT INTO rfqs (reference_id, name, bid_start_time, original_close_time, bid_close_time,
                           forced_close_time, pickup_date, trigger_window_minutes,
                           extension_minutes, extension_trigger, created_by)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [v.referenceId, v.name, v.start, v.close, v.forced, v.pickupDate, v.x, v.y, v.trigger, user.id]
      );
      rfq = rows[0];
    } catch (e) {
      if (e.code === '23505') throw new AppError(409, 'An RFQ with this reference_id already exists');
      throw e;
    }

    await db.query(
      `INSERT INTO activity_logs (rfq_id, type, message) VALUES ($1,'RFQ_CREATED',$2)`,
      [rfq.id, `RFQ "${rfq.name}" created by ${user.name}`]
    );
    return { ...rfq, status: computeStatus(rfq) };
  });
}

async function listRfqs() {
  const { rows } = await query(
    `SELECT r.id, r.reference_id, r.name, r.bid_start_time, r.original_close_time,
            r.bid_close_time, r.forced_close_time,
            (SELECT MIN(total_price) FROM bids b WHERE b.rfq_id = r.id) AS current_lowest_bid
       FROM rfqs r
      WHERE r.is_british_auction
      ORDER BY r.created_at DESC`
  );
  const now = new Date();
  return rows.map((r) => ({ ...r, status: computeStatus(r, now) }));
}

async function getRfqDetails(id) {
  const { rows: [rfq] } = await query('SELECT * FROM rfqs WHERE id = $1', [id]);
  if (!rfq) throw new AppError(404, 'RFQ not found');

  const [bids, ranking, logs] = await Promise.all([
    query(
      `SELECT b.id, b.supplier_id, u.name AS supplier_name, b.carrier_name,
              b.freight_charges, b.origin_charges, b.destination_charges, b.total_price,
              b.transit_time_days, b.quote_valid_until, b.created_at,
              rk.rank::int AS rank
         FROM bids b
         JOIN users u ON u.id = b.supplier_id
         LEFT JOIN rfq_supplier_ranks rk ON rk.bid_id = b.id
        WHERE b.rfq_id = $1
        ORDER BY b.total_price ASC, b.created_at ASC`,
      [id]
    ),
    query(
      `SELECT rk.rank::int AS rank, 'L' || rk.rank AS label, rk.supplier_id,
              u.name AS supplier_name, rk.total_price
         FROM rfq_supplier_ranks rk JOIN users u ON u.id = rk.supplier_id
        WHERE rk.rfq_id = $1 ORDER BY rk.rank`,
      [id]
    ),
    query('SELECT * FROM activity_logs WHERE rfq_id = $1 ORDER BY created_at ASC, id ASC', [id]),
  ]);

  return {
    rfq: { ...rfq, status: computeStatus(rfq) },
    config: {
      trigger_window_minutes: rfq.trigger_window_minutes, // X
      extension_minutes: rfq.extension_minutes,           // Y
      extension_trigger: rfq.extension_trigger,
    },
    server_time: new Date(), // lets the frontend correct for clock drift in the countdown
    ranking: ranking.rows,
    bids: bids.rows,
    activity_log: logs.rows,
  };
}

module.exports = { createRfq, listRfqs, getRfqDetails };
