import { useEffect, useRef } from 'react';
import { useLocation, useMatches } from 'react-router-dom';
import { reportSlowPage, setCurrentRoute, trackActivity } from '@/lib/telemetry';

/** Automatic page views with the route *pattern* (never the ids) and time on page. */
export function RouteTracker() {
  const location = useLocation();
  const matches = useMatches();
  const last = useRef<{ route: string; at: number } | null>(null);

  useEffect(() => {
    const deepest = matches[matches.length - 1];
    const pattern = (deepest as { route?: { path?: string } } | undefined)?.route?.path;
    const route = buildPattern(matches) || pattern || location.pathname;
    const now = performance.now();
    if (last.current) {
      trackActivity({
        type: 'page_view',
        route: last.current.route,
        durationMs: Math.round(now - last.current.at),
        meta: { leave: true },
      });
    }
    setCurrentRoute(route);
    trackActivity({ type: 'page_view', route });
    last.current = { route, at: now };
    const started = now;
    requestAnimationFrame(() => reportSlowPage(route, performance.now() - started));
  }, [location.pathname, matches]);

  return null;
}

/** Joins matched route ids into `/clinic/patients/:id/chart`. */
function buildPattern(matches: ReturnType<typeof useMatches>): string {
  const last = matches[matches.length - 1];
  if (!last) return '';
  let path = last.pathname;
  for (const [k, v] of Object.entries(last.params)) {
    if (v) path = path.replace(v, `:${k}`);
  }
  return path;
}
