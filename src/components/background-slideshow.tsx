'use client';

import { useEffect, useState } from 'react';

/**
 * CampusCab background image set (public/images).
 * Slide order: 1 → 2 → 3 → 4 → 5 → 6 → loop.
 */
export const CAMPUSCAB_BACKGROUND_IMAGES = [
  '/images/campuscab-bg-1.jpg',
  '/images/campuscab-bg-2.jpg',
  '/images/campuscab-bg-3.jpg',
  '/images/campuscab-bg-4.jpg',
  '/images/campuscab-bg-5.jpg',
  '/images/campuscab-bg-6.jpg',
];

/**
 * Phone-sized re-encodes of the same six images (480w, mozjpeg q65 — the
 * full set is ~64% smaller, so mobile login downloads ~138KB instead of
 * ~382KB). Only the default set has variants; custom `images` overrides fall
 * back to their full-size file.
 */
const SMALL_SRC_BY_FULL = new Map(
  CAMPUSCAB_BACKGROUND_IMAGES.map((src) => [src, src.replace(/\.jpg$/, '-sm.jpg')])
);

/** Viewports ≤640px CSS get the lightweight variant (same art, no redesign). */
const SMALL_SRC_MEDIA = '(max-width: 640px)';

type BackgroundSlideshowProps = {
  /** Positioning/layering classes for the slideshow layer, e.g. "absolute inset-0 z-0" */
  className?: string;
  /** Classes for the readability scrim rendered above the images */
  overlayClassName?: string;
  /** Override the ordered image set */
  images?: string[];
  /** Time each image stays visible (ms) */
  intervalMs?: number;
  /** Crossfade duration (ms) */
  transitionMs?: number;
}

/**
 * Decorative, full-bleed background slideshow.
 *
 * - Every image is mounted at once so the browser preloads them all (no flash
 *   or blank frame between slides).
 * - Crossfades via opacity only: no layout shift, no page reload, no controls.
 * - Purely visual: it is aria-hidden and never intercepts pointer events.
 */
export default function BackgroundSlideshow({
  className = '',
  overlayClassName = '',
  images = CAMPUSCAB_BACKGROUND_IMAGES,
  intervalMs = 5500,
  transitionMs = 900,
}: BackgroundSlideshowProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (images.length < 2) return;

    // Respect reduced-motion: hold on the first image instead of cycling.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduceMotion.matches) return;

    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % images.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [images.length, intervalMs]);

  return (
    <div className={className} aria-hidden="true" style={{ pointerEvents: 'none' }}>
      {/* Base paint so the very first frame is never blank/white */}
      <div className="absolute inset-0 bg-[var(--background)]" />

      {images.map((src, index) => {
        const smallSrc = SMALL_SRC_BY_FULL.get(src);
        return (
          // Native <picture>/<img> is intentional: mounting all slides
          // eagerly preloads one file per slide so crossfades never reveal an
          // empty frame. Phones take the -sm.jpg source (same artwork,
          // re-encoded for bandwidth); everything else takes the full file.
          <picture key={src} className="absolute inset-0">
            {smallSrc && <source media={SMALL_SRC_MEDIA} srcSet={smallSrc} />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              draggable={false}
              loading="eager"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                objectPosition: 'center',
                opacity: index === activeIndex ? 1 : 0,
                transition: `opacity ${transitionMs}ms ease-in-out`,
                willChange: 'opacity',
              }}
            />
          </picture>
        );
      })}

      {/* Readability scrim */}
      <div className={`absolute inset-0 ${overlayClassName}`} />
    </div>
  );
}
