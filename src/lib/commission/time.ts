/**
 * Business-day/timezone helpers for the commission system.
 *
 * The server runs in UTC, but CampusCab's business day is defined in a
 * configurable timezone (default Africa/Lagos, UTC+1). These helpers derive
 * explicit daily boundaries from the configured timezone via Intl — no
 * server-local-time assumptions and no external date library.
 *
 * A "business day key" is stored as UTC midnight of the local calendar date
 * (e.g. rides completed on 2026-10-21 in Lagos all get earningDate =
 * 2026-10-21T00:00:00.000Z). Aggregations group by that key, so a ride can
 * never be counted in two days.
 */

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsIn(date: Date, timeZone: string): DateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  // Intl can render hour "24" for midnight in some environments.
  const hour = Number(map.hour === '24' ? '00' : map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Offset (minutes east of UTC) of `timeZone` at the given instant. */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Compare against the instant truncated to whole seconds.
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/** Convert wall-clock time in `timeZone` to the UTC instant. */
export function zonedWallClockToUtc(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone: string
): Date {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    0
  );
  const off1 = tzOffsetMinutes(new Date(guess), timeZone);
  let ts = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(ts), timeZone);
  if (off2 !== off1) ts = guess - off2 * 60000;
  return new Date(ts);
}

/**
 * Business-day key (UTC midnight of the local calendar date) containing
 * `instant`, for the given timezone.
 */
export function businessDayKey(instant: Date, timeZone: string): Date {
  const p = partsIn(instant, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

/** The business-day key of `key` plus `days` calendar days. */
export function addBusinessDays(key: Date, days: number): Date {
  return new Date(key.getTime() + days * 86_400_000);
}

/**
 * UTC instant range [start, end) covered by the business day `dayKey`
 * in `timeZone`. start is inclusive, end is exclusive — grouping is exact.
 */
export function businessDayRange(dayKey: Date, timeZone: string): {
  start: Date;
  end: Date;
} {
  const start = zonedWallClockToUtc(
    { year: dayKey.getUTCFullYear(), month: dayKey.getUTCMonth() + 1, day: dayKey.getUTCDate() },
    timeZone
  );
  const nextKey = addBusinessDays(dayKey, 1);
  const end = zonedWallClockToUtc(
    { year: nextKey.getUTCFullYear(), month: nextKey.getUTCMonth() + 1, day: nextKey.getUTCDate() },
    timeZone
  );
  return { start, end };
}

/** Yesterday's business-day key relative to `now` in `timeZone` (the last *completed* business day). */
export function previousBusinessDayKey(now: Date, timeZone: string): Date {
  const today = businessDayKey(now, timeZone);
  return addBusinessDays(today, -1);
}

/**
 * The business day a scheduled settlement should cover.
 *
 * Normally that is the last completed business day. When the configured
 * release hour (business timezone) has not been reached yet today, the
 * previous business day is settled instead.
 *
 * The target SHIFTS rather than blocking: a daily scheduler therefore always
 * has a period to settle, even when the release hour is set later than the
 * time the scheduler fires. Nothing is lost — `prepareSettlement` sweeps every
 * still-outstanding entry up to the target day, so a deferred period is
 * settled by the next run instead of being stranded.
 */
export function settlementTargetDayKey(
  now: Date,
  timeZone: string,
  releaseHourLocal: number
): Date {
  const lastCompleted = previousBusinessDayKey(now, timeZone);
  const localHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(now)
  ) % 24;

  if (localHour >= releaseHourLocal) return lastCompleted;
  return addBusinessDays(lastCompleted, -1);
}

/** ISO date string (YYYY-MM-DD) for a business-day key. */
export function dayKeyToIso(key: Date): string {
  return key.toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD string into a business-day key. */
export function isoToDayKey(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
