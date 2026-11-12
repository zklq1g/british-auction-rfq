import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { usePolling } from '../usePolling';
import { useUser } from '../UserContext';
import StatusBadge from '../components/StatusBadge';
import Countdown from '../components/Countdown';
import BidForm from '../components/BidForm';
import ActivityLog from '../components/ActivityLog';
import { TRIGGER_LABELS, fmtDate, fmtDateTime, fmtMoney, wasExtended } from '../utils';

export default function AuctionDetails() {
  const { id } = useParams();
  const { user } = useUser();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const offsetMs = useRef(0); // serverTime - clientTime

  const load = useCallback(async () => {
    try {
      const d = await api(`/rfqs/${id}`);
      offsetMs.current = new Date(d.server_time).getTime() - Date.now();
      setData(d);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  usePolling(load, 3000, [id]);

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  const { rfq, config, ranking, bids, activity_log } = data;
  const upcoming = rfq.status === 'UPCOMING';
  const active = rfq.status === 'ACTIVE';

  return (
    <>
      <Link to="/auctions">← All auctions</Link>

      <div className="row-between header-block">
        <div>
          <h2>{rfq.name}</h2>
          <div className="muted">{rfq.reference_id} · Pickup {fmtDate(rfq.pickup_date)}</div>
        </div>
        <div className="right">
          <StatusBadge status={rfq.status} />
          {(active || upcoming) && (
            <div className="timer-block">
              <small>{upcoming ? 'Starts in' : 'Closes in'}</small>
              <Countdown
                target={upcoming ? rfq.bid_start_time : rfq.bid_close_time}
                offsetMs={offsetMs.current}
                windowMinutes={active ? config.trigger_window_minutes : 0}
                onExpire={load}
              />
            </div>
          )}
        </div>
      </div>

      <section className="grid-3">
        <div className="card">
          <h3>Auction Timing</h3>
          <dl>
            <dt>Bid Start</dt><dd>{fmtDateTime(rfq.bid_start_time)}</dd>
            <dt>Original Close</dt><dd>{fmtDateTime(rfq.original_close_time)}</dd>
            <dt>Current Close</dt>
            <dd>
              <strong>{fmtDateTime(rfq.bid_close_time)}</strong>
              {wasExtended(rfq) && <span className="tag">extended</span>}
            </dd>
            <dt>Forced Close</dt><dd>{fmtDateTime(rfq.forced_close_time)}</dd>
          </dl>
        </div>

        <div className="card">
          <h3>British Auction Configuration</h3>
          <dl>
            <dt>Trigger Window (X)</dt><dd>{config.trigger_window_minutes} min</dd>
            <dt>Extension (Y)</dt><dd>{config.extension_minutes} min</dd>
            <dt>Trigger Rule</dt>
            <dd>{TRIGGER_LABELS[config.extension_trigger]}</dd>
          </dl>
        </div>

        <div className="card">
          <h3>Supplier Rankings (Leaderboard)</h3>
          {ranking.length === 0 ? (
            <p className="muted">No bids placed yet.</p>
          ) : (
            <ol className="ranking">
              {ranking.map((r) => (
                <li key={r.supplier_id}>
                  <span className={`rank rank-${r.rank <= 3 ? r.rank : 'n'}`}>{r.label}</span>
                  {r.supplier_name}
                  <span className="num">{fmtMoney(r.total_price)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {user.role === 'SUPPLIER' && active && <BidForm rfqId={rfq.id} onPlaced={load} />}
      {user.role === 'SUPPLIER' && !active && (
        <div className="card">
          <p className="muted">Bidding is {upcoming ? 'not open yet' : 'closed'} for this RFQ.</p>
        </div>
      )}

      <h3>Submitted Quotes (Sorted by Price)</h3>
      {bids.length === 0 ? (
        <p className="muted">No quotes submitted yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Supplier</th>
              <th>Carrier</th>
              <th className="num">Freight</th>
              <th className="num">Origin</th>
              <th className="num">Destination</th>
              <th className="num">Total Quote</th>
              <th className="num">Transit (Days)</th>
              <th>Valid Until</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {bids.map((b) => (
              <tr key={b.id} className={b.rank ? '' : 'superseded'}>
                <td>
                  {b.rank ? (
                    <span className={`rank rank-${b.rank <= 3 ? b.rank : 'n'}`}>L{b.rank}</span>
                  ) : (
                    <span className="muted" title="Superseded by this supplier's better quote">—</span>
                  )}
                </td>
                <td><strong>{b.supplier_name}</strong></td>
                <td>{b.carrier_name}</td>
                <td className="num">{fmtMoney(b.freight_charges)}</td>
                <td className="num">{fmtMoney(b.origin_charges)}</td>
                <td className="num">{fmtMoney(b.destination_charges)}</td>
                <td className="num"><strong>{fmtMoney(b.total_price)}</strong></td>
                <td className="num">{b.transit_time_days}</td>
                <td>{fmtDate(b.quote_valid_until)}</td>
                <td>{fmtDateTime(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Activity & Extension Log</h3>
      <ActivityLog logs={activity_log} />
    </>
  );
}
