/**
 * CampusCab fixed fare calculator.
 *
 * Server-side source of truth for ride pricing. The frontend never controls
 * the amount — every payment is derived from the selected ride type only.
 *
 * Pricing (updated 2026):
 *  - Shared Shuttle: ₦200 ride + ₦10 platform fee = ₦210 total
 *  - Solo Cab:       ₦800 ride + ₦10 platform fee = ₦810 total
 *
 * Platform fee changed from ₦30 → ₦10. Do not reintroduce ₦30 logic.
 */

export const SOLO_CAB_RIDE_FARE = 800; // ₦800 fixed Solo Cab ride fare
export const SHARED_SHUTTLE_RIDE_FARE = 200; // ₦200 fixed Shared Shuttle ride fare
export const PLATFORM_FEE = 10; // ₦10 CampusCab platform/service fee per booking

export type RideFareBreakdown = {
  rideFare: number;
  platformFee: number;
  totalAmount: number;
};

export function calculateFare(
  rideType: 'SOLO_QUICK_CAB' | 'SHARED_SHUTTLE'
): RideFareBreakdown {
  const rideFare =
    rideType === 'SOLO_QUICK_CAB' ? SOLO_CAB_RIDE_FARE : SHARED_SHUTTLE_RIDE_FARE;
  const platformFee = PLATFORM_FEE;
  const totalAmount = rideFare + platformFee;

  return { rideFare, platformFee, totalAmount };
}
