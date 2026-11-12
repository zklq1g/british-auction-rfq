import { useState } from 'react';
import { api } from '../api';
import { fmtMoney, toLocalInput } from '../utils';

const defaultValidity = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return toLocalInput(d).slice(0, 10);
};

const empty = () => ({
  carrier_name: '',
  freight_charges: '',
  origin_charges: '',
  destination_charges: '',
  transit_time_days: '',
  quote_valid_until: defaultValidity(),
});

export default function BidForm({ rfqId, onPlaced }) {
  const [f, setF] = useState(empty());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const total =
    (Number(f.freight_charges) || 0) +
    (Number(f.origin_charges) || 0) +
    (Number(f.destination_charges) || 0);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await api(`/rfqs/${rfqId}/bids`, { method: 'POST', body: f });
      setNotice(
        `Bid placed. You are L${res.rank}.` + (res.extended ? ' The auction was extended!' : '')
      );
      setF(empty());
      onPlaced();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <h3>Submit a quote</h3>

      <label>Carrier name
        <input required value={f.carrier_name} onChange={set('carrier_name')} placeholder="e.g. Maersk / MSC / Hapag-Lloyd" />
      </label>
      <label>Freight charges
        <input required type="number" min="0" step="0.01" value={f.freight_charges} onChange={set('freight_charges')} placeholder="1200.00" />
      </label>
      <label>Origin charges
        <input required type="number" min="0" step="0.01" value={f.origin_charges} onChange={set('origin_charges')} placeholder="150.00" />
      </label>
      <label>Destination charges
        <input required type="number" min="0" step="0.01" value={f.destination_charges} onChange={set('destination_charges')} placeholder="100.00" />
      </label>
      <label>Transit time (days)
        <input required type="number" min="1" step="1" value={f.transit_time_days} onChange={set('transit_time_days')} placeholder="15" />
      </label>
      <label>Quote valid until
        <input required type="date" value={f.quote_valid_until} onChange={set('quote_valid_until')} />
      </label>

      <div className="form-footer">
        <strong>Total Quote: {fmtMoney(total)}</strong>
        <button disabled={busy}>{busy ? 'Submitting…' : 'Place bid'}</button>
      </div>
      {error && <p className="error full">{error}</p>}
      {notice && <p className="success full">{notice}</p>}
    </form>
  );
}
