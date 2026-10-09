'use client';

import { useEffect, useRef, useState } from 'react';
import type { LatLngExpression } from 'leaflet';
import L from 'leaflet';


export interface CampusMapProps {
  className?: string;
  height?: string;
  markers?: Array<{ name: string; position: [number, number] }>;
}

export default function CampusMap({
  className = '',
  height = '220px',
  markers = [],
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const attributionRef = useRef<HTMLElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: L.Map | null = null;
    let tileLayer: L.TileLayer | null = null;

    try {
      // Keep Leaflet's default CSS from clashing with Tailwind by scoping
      // it via a child class where possible. This component still depends on
      // leaflet.css being bundled (see package.json postinstall note).
      map = L.map(containerRef.current, {
        center: [6.5148, 3.3956],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
        fadeAnimation: true,
        zoomAnimation: true,
      });

      tileLayer = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
          minZoom: 12,
          opacity: 0.9,
        }
      );

      tileLayer.addTo(map);

      // Façade markers only for locations we already have coordinates for.
      markers.forEach((m) => {
        if (!map) return;
        L.circleMarker(m.position as LatLngExpression, {
          radius: 7,
          color: '#4338ca',
          fillColor: '#818cf8',
          fillOpacity: 0.9,
          weight: 2,
        })
          .bindTooltip(m.name, { direction: 'top', offset: [0, -4] })
          .addTo(map);
      });

      // Attribution footer (required by OSM usage policy).
      const attributionDiv = document.createElement('div');
      attributionDiv.className =
        'leaflet-control leaflet-control-attribution text-[11px] leading-none select-none';
      attributionDiv.style.padding = '2px 6px';
      attributionDiv.style.background = 'rgba(255,255,255,0.7)';
      attributionDiv.style.color = 'var(--muted-fg)';
      attributionDiv.style.backdropFilter = 'blur(2px)';
      attributionDiv.innerHTML =
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

      (map as unknown as { addControl(el: HTMLElement): void }).addControl(attributionDiv);

      mapRef.current = map;
    } catch (err) {
      console.warn('[CampusMap] map initialization failed', err);
      // Defer the state update so the effect doesn't setState synchronously.
      queueMicrotask(() => setFailed(true));
    }

    return () => {
      if (map) {
        map.remove();
        mapRef.current = null;
      }
      tileLayer = null;
    };
  }, [markers]);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-[var(--surface-2)] rounded-2xl border border-[var(--border-color)] ${className}`}
        style={{ height }}
        role="img"
        aria-label="Campus map unavailable"
      >
        <span className="text-sm text-[var(--muted)]">Map unavailable</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`rounded-2xl overflow-hidden border border-[var(--border-color)] ${className}`}
      style={{ height, width: '100%' }}
    />
  );
}
