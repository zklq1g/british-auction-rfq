const { AppError } = require('./errors');
const { TRIGGERS } = require('./auctionEngine');

const bad = (msg) => new AppError(400, msg);

function parseDate(value, field) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw bad(`${field} must be a valid date-time`);
  return d;
}

function parsePositiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${field} must be a positive integer`);
  return n;
}

function parseMoney(value, field) {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(n) || n < 0)
    throw bad(`${field} must be a non-negative number`);
  return Math.round(n * 100) / 100;
}

function parseCreateRfq(body) {
  const name = String(body.name || '').trim();
  const referenceId = String(body.reference_id || '').trim();
  if (!name) throw bad('name is required');
  if (!referenceId) throw bad('reference_id is required');

  const start = parseDate(body.bid_start_time, 'bid_start_time');
  const close = parseDate(body.bid_close_time, 'bid_close_time');
  const forced = parseDate(body.forced_close_time, 'forced_close_time');
  const pickup = parseDate(body.pickup_date, 'pickup_date');

  if (close <= start) throw bad('Bid close time must be after bid start time');
  if (forced <= close) throw bad('Forced close time must be later than bid close time');
  if (close <= new Date()) throw bad('Bid close time must be in the future');

  const x = parsePositiveInt(body.trigger_window_minutes, 'trigger_window_minutes (X)');
  const y = parsePositiveInt(body.extension_minutes, 'extension_minutes (Y)');
  if (x * 60 * 1000 > close - start) throw bad('Trigger window (X) cannot be longer than the auction duration');

  if (!TRIGGERS.includes(body.extension_trigger))
    throw bad(`extension_trigger must be one of ${TRIGGERS.join(', ')}`);

  return {
    name,
    referenceId,
    start,
    close,
    forced,
    pickupDate: pickup.toISOString().slice(0, 10),
    x,
    y,
    trigger: body.extension_trigger,
  };
}

function parseBid(body) {
  const carrierName = String(body.carrier_name || '').trim();
  if (!carrierName) throw bad('carrier_name is required');

  const freight = parseMoney(body.freight_charges, 'freight_charges');
  const origin = parseMoney(body.origin_charges, 'origin_charges');
  const destination = parseMoney(body.destination_charges, 'destination_charges');
  const transitDays = parsePositiveInt(body.transit_time_days, 'transit_time_days');
  const validUntil = parseDate(body.quote_valid_until, 'quote_valid_until');

  return {
    carrierName,
    freight,
    origin,
    destination,
    transitDays,
    validUntil: validUntil.toISOString().slice(0, 10),
    totalCents: Math.round((freight + origin + destination) * 100),
  };
}

module.exports = { parseCreateRfq, parseBid };
