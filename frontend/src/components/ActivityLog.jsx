import { fmtDateTime } from '../utils';

const ICONS = {
  RFQ_CREATED: '📝',
  BID_PLACED: '💰',
  TIME_EXTENDED: '⏱️',
  AUCTION_CLOSED: '🔒',
  AUCTION_FORCE_CLOSED: '⛔',
};

export default function ActivityLog({ logs }) {
  if (!logs.length) return <p className="muted">No activity yet.</p>;

  // Newest first reads better for a live auction
  const items = [...logs].reverse();

  return (
    <ul className="timeline">
      {items.map((l) => (
        <li key={l.id} className={`timeline-${l.type}`}>
          <span className="timeline-icon">{ICONS[l.type] || '•'}</span>
          <div>
            <div>{l.message}</div>
            {l.type === 'TIME_EXTENDED' && (
              <div className="muted">
                {fmtDateTime(l.old_close_time)} → <strong>{fmtDateTime(l.new_close_time)}</strong>
              </div>
            )}
            <small className="muted">{fmtDateTime(l.created_at)}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}
