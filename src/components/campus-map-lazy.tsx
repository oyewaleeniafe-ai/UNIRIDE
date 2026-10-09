'use client';

import dynamic from 'next/dynamic';
import type { CampusMapProps } from './campus-map';

const CampusMapDynamic = dynamic(() => import('./campus-map').then((m) => m.default), {
  ssr: false,
});

/**
 * SSR-safe lazy wrapper around CampusMap.
 *
 * `next/dynamic` with `ssr: false` is only allowed inside Client Components,
 * so the dashboards (Server Components) import this wrapper instead of the
 * map module directly. Leaflet never loads during server rendering.
 *
 * A skeleton sits behind the map container and shows through until the
 * lazily-loaded map paints its tiles, so there is no layout shift.
 */
export default function CampusMapLazy({
  className = '',
  height = '220px',
  markers = [],
}: CampusMapProps) {
  return (
    <div className={`relative ${className}`} style={{ height }}>
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-pulse rounded-2xl bg-[var(--surface-2)]"
      />
      <div className="absolute inset-0">
        <CampusMapDynamic height={height} markers={markers} />
      </div>
    </div>
  );
}
