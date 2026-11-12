import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useUser } from '../UserContext';
import { TRIGGER_LABELS, toLocalInput } from '../utils';

function initial() {
  const now = new Date();
  const plus = (min) => new Date(now.getTime() + min * 60000);
  return {
    name: '',
    reference_id: '',
    bid_start_time: toLocalInput(now),
    bid_close_time: toLocalInput(plus(30)),
    forced_close_time: toLocalInput(plus(60)),
    pickup_date: toLocalInput(plus(14 * 24 * 60)).slice(0, 10),
    trigger_window_minutes: 10,
    extension_minutes: 5,
    extension_trigger: 'ANY_BID',
  };
}

function validate(f) {
  const start = new Date(f.bid_start_time);
  const close = new Date(f.bid_close_time);
  const forced = new Date(f.forced_close_time);
  if (close <= start) return 'Bid close time must be after bid start time';
  if (forced <= close) return 'Forced close time must be later than bid close time';
  if (close <= new Date()) return 'Bid close time must be in the future';
  if (Number(f.trigger_window_minutes) * 60000 > close - start)
    return 'Trigger window (X) cannot be longer than the auction duration';
  return '';
}

export default function CreateRfq() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [f, setF] = useState(initial());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user.role !== 'BUYER')
    return <p className="error">Only buyers can create RFQs. Switch user in the top-right.</p>;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const problem = validate(f);
    if (problem) return setError(problem);

    setError('');
    setBusy(true);
    try {
      // datetime-local has no timezone, so convert to an absolute ISO instant before sending
      const rfq = await api('/rfqs', {
        method: 'POST',
        body: {
          ...f,
          bid_start_time: new Date(f.bid_start_time).toISOString(),
          bid_close_time: new Date(f.bid_close_time).toISOString(),
          forced_close_time: new Date(f.forced_close_time).toISOString(),
        },
      });
      navigate(`/auctions/${rfq.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <h2>Create RFQ (British Reverse Auction)</h2>

      <label>RFQ Name
        <input required value={f.name} onChange={set('name')} placeholder="Mumbai to Rotterdam, 20ft container" />
      </label>
      <label>Reference ID
        <input required value={f.reference_id} onChange={set('reference_id')} placeholder="RFQ-002" />
      </label>
      <label>Bid Start Time
        <input required type="datetime-local" value={f.bid_start_time} onChange={set('bid_start_time')} />
      </label>
      <label>Bid Close Time
        <input required type="datetime-local" value={f.bid_close_time} onChange={set('bid_close_time')} />
      </label>
      <label>Forced Bid Close Time <small>(must be later than bid close time)</small>
        <input required type="datetime-local" value={f.forced_close_time} onChange={set('forced_close_time')} />
      </label>
      <label>Pickup / Service Date
        <input required type="date" value={f.pickup_date} onChange={set('pickup_date')} />
      </label>

      <fieldset className="full">
        <legend>British Auction Configuration Options</legend>
        <div className="form-grid">
          <label>Trigger Window X (minutes)
            <input required type="number" min="1" step="1" value={f.trigger_window_minutes} onChange={set('trigger_window_minutes')} />
          </label>
          <label>Extension Duration Y (minutes)
            <input required type="number" min="1" step="1" value={f.extension_minutes} onChange={set('extension_minutes')} />
          </label>
          <label className="full">Extension Trigger Mode
            <select value={f.extension_trigger} onChange={set('extension_trigger')}>
              {Object.entries(TRIGGER_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      {error && <p className="error full">{error}</p>}
      <div className="form-footer full">
        <span />
        <button disabled={busy}>{busy ? 'Creating…' : 'Create RFQ'}</button>
      </div>
    </form>
  );
}
