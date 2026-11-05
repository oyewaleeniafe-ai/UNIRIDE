/**
 * Integer-kobo money helpers for the CampusCab commission system.
 *
 * Every commission amount is stored and computed as an INTEGER number of
 * kobo (₦1 = 100 kobo). JavaScript floating point is never used as the
 * authoritative financial calculation — NGN floats from the legacy
 * Payment/Trip columns are converted exactly once at this boundary.
 *
 * Rounding rule: commission is rounded HALF-UP at kobo precision
 * (a remainder of 0.5 kobo or more rounds up). Driver net = eligible − commission,
 * so rounding always favors neither party beyond 1 kobo and is deterministic.
 */

/** Convert NGN (major units) to integer kobo, exactly. */
export function toKobo(naira: number): number {
  if (!Number.isFinite(naira)) {
    throw new Error(`Invalid naira amount: ${naira}`);
  }
  return Math.round(naira * 100);
}

/** Convert integer kobo back to NGN for display only (never for math). */
export function fromKobo(kobo: number): number {
  return kobo / 100;
}

/** Format integer kobo as a display string, e.g. ₦1,234.50 */
export function formatKobo(kobo: number): string {
  const naira = fromKobo(kobo);
  const sign = naira < 0 ? '-' : '';
  const abs = Math.abs(naira);
  return `${sign}₦${abs.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * School commission for an eligible amount, in kobo.
 *
 * `rateBps` is basis points (500 bps = 5.00%). Rounded half-up.
 */
export function commissionKobo(eligibleKobo: number, rateBps: number): number {
  assertInt(eligibleKobo, 'eligibleKobo');
  assertInt(rateBps, 'rateBps');
  if (rateBps < 0 || rateBps > 10000) {
    throw new Error(`Commission rate out of range: ${rateBps} bps`);
  }
  // (a * b + 5000) / 10000 floors at half-up for non-negative values.
  return Math.floor((eligibleKobo * rateBps + 5000) / 10000);
}

/** Driver net after school commission, in kobo. */
export function netKobo(eligibleKobo: number, rateBps: number): number {
  return eligibleKobo - commissionKobo(eligibleKobo, rateBps);
}

/** Render basis points as a percent string, e.g. 500 -> "5%" / 125 -> "1.25%". */
export function rateBpsToPercent(rateBps: number): string {
  const percent = rateBps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

function assertInt(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer (kobo), got ${value}`);
  }
}
