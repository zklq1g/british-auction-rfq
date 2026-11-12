const MINUTE = 60 * 1000;
const TRIGGERS = ['ANY_BID', 'ANY_RANK_CHANGE', 'L1_CHANGE'];

/** Is `now` inside [closeTime - X min, closeTime) ? */
function isInTriggerWindow(now, closeTime, xMinutes) {
  const windowStart = closeTime.getTime() - xMinutes * MINUTE;
  return now.getTime() >= windowStart && now.getTime() < closeTime.getTime();
}

/**
 * before / after: rankings ordered L1 first, e.g. [{ supplier_id, supplier_name, total_price }]
 * Returns { triggered, reason }.
 */
function evaluateTrigger(type, before, after) {
  const ids = (r) => r.map((x) => String(x.supplier_id));

  switch (type) {
    case 'ANY_BID':
      return { triggered: true, reason: 'a bid was received in the trigger window' };

    case 'ANY_RANK_CHANGE': {
      const b = ids(before);
      const a = ids(after);
      const changed = b.length !== a.length || b.some((id, i) => id !== a[i]);
      return {
        triggered: changed,
        reason: changed ? 'supplier rankings changed in the trigger window' : 'no rank change',
      };
    }

    case 'L1_CHANGE': {
      const oldL1 = before[0];
      const newL1 = after[0];
      const changed = !oldL1 || !newL1 || String(oldL1.supplier_id) !== String(newL1.supplier_id);
      return {
        triggered: changed,
        reason: changed
          ? `L1 changed from ${oldL1 ? oldL1.supplier_name : 'none'} to ${newL1 ? newL1.supplier_name : 'none'}`
          : 'L1 unchanged',
      };
    }

    default:
      throw new Error(`Unknown trigger type: ${type}`);
  }
}

/** Adds Y minutes to the CURRENT close time, but never beyond the forced close time. */
function computeNewCloseTime(currentClose, forcedClose, yMinutes) {
  const candidate = new Date(currentClose.getTime() + yMinutes * MINUTE);
  const capped = candidate.getTime() > forcedClose.getTime();
  return { newCloseTime: capped ? forcedClose : candidate, capped };
}

/** Status is computed on read, so no cron job is needed. */
function computeStatus(rfq, now = new Date()) {
  if (now < new Date(rfq.bid_start_time)) return 'UPCOMING';
  if (now < new Date(rfq.bid_close_time)) return 'ACTIVE';
  return new Date(rfq.bid_close_time).getTime() === new Date(rfq.forced_close_time).getTime()
    ? 'FORCE_CLOSED'
    : 'CLOSED';
}

module.exports = { TRIGGERS, isInTriggerWindow, evaluateTrigger, computeNewCloseTime, computeStatus };
