import { useEffect, useRef } from 'react';

/** Calls fn immediately, then every `ms` while the tab is visible. */
export function usePolling(fn, ms, deps = []) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    saved.current();
    const id = setInterval(() => {
      if (!document.hidden) saved.current();
    }, ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}
