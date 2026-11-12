export const TRIGGER_LABELS = {
  ANY_BID: 'Bid received in last X minutes',
  ANY_RANK_CHANGE: 'Any supplier rank change in last X minutes',
  L1_CHANGE: 'Lowest bidder (L1) change in last X minutes',
};

export const fmtMoney = (n) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDateTime = (d) =>
  new Date(d).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

export const fmtDate = (d) => String(d).slice(0, 10); // backend sends YYYY-MM-DD

/** Value for <input type="datetime-local"> in the user's local time */
export function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const wasExtended = (rfq) =>
  new Date(rfq.bid_close_time).getTime() !== new Date(rfq.original_close_time).getTime();
