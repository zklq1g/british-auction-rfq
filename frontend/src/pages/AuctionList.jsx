import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../usePolling';
import { useUser } from '../UserContext';
import StatusBadge from '../components/StatusBadge';
import { fmtDateTime, fmtMoney, wasExtended } from '../utils';

export default function AuctionList() {
  const { user } = useUser();
  const [rfqs, setRfqs] = useState(null);
  const [error, setError] = useState('');

  usePolling(
    () => api('/rfqs').then((d) => { setRfqs(d); setError(''); }).catch((e) => setError(e.message)),
    5000
  );

  return (
    <>
      <div className="row-between">
        <h2>British Reverse Auctions</h2>
        {user.role === 'BUYER' && <Link className="btn" to="/create">+ Create RFQ</Link>}
      </div>

      {error && <p className="error">{error}</p>}
      {!rfqs ? <p>Loading…</p> : rfqs.length === 0 ? (
        <p className="muted">No auctions yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>RFQ Name / Reference ID</th>
              <th className="num">Current Lowest Bid (L1)</th>
              <th>Current Close Time</th>
              <th>Forced Close Time</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rfqs.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/auctions/${r.id}`}><strong>{r.name}</strong></Link>
                  <div className="muted">{r.reference_id}</div>
                </td>
                <td className="num">
                  {r.current_lowest_bid != null ? <strong>{fmtMoney(r.current_lowest_bid)}</strong> : '—'}
                </td>
                <td>
                  {fmtDateTime(r.bid_close_time)}
                  {wasExtended(r) && <span className="tag">extended</span>}
                </td>
                <td>{fmtDateTime(r.forced_close_time)}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
