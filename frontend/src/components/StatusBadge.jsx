const LABELS = {
  UPCOMING: 'Upcoming',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  FORCE_CLOSED: 'Force Closed',
};

export default function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] || status}</span>;
}
