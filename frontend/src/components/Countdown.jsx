import { useEffect, useState } from 'react';

function format(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export default function Countdown({ target, offsetMs = 0, windowMinutes = 0, onExpire }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const remaining = new Date(target).getTime() - (now + offsetMs);
  const expired = remaining <= 0;
  const inWindow = !expired && windowMinutes && remaining <= windowMinutes * 60 * 1000;

  // When time runs out, ask the parent to refetch (status may flip, or an extension may have landed)
  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, target]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className={`countdown ${inWindow ? 'countdown-hot' : ''}`}>
      {format(remaining)}
      {inWindow && <small> · in trigger window</small>}
    </span>
  );
}
