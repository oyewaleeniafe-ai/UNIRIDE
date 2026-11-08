import { prisma } from '@/lib/prisma';
import { json } from '@/lib/mobile/http';
import { calculateFare } from '@/lib/fares';

export const dynamic = 'force-dynamic';

/**
 * Campus locations and the current fare table.
 *
 * Both come from the database and the shared fare calculator — the app never
 * hardcodes locations or prices.
 */
export async function GET() {
  const locations = await prisma.campusLocation.findMany({ orderBy: { name: 'asc' } });

  return json({
    locations: locations.map((location) => ({
      id: location.id,
      name: location.name,
      lat: location.lat,
      lng: location.lng,
    })),
    fares: {
      SOLO_QUICK_CAB: calculateFare('SOLO_QUICK_CAB'),
      SHARED_SHUTTLE: calculateFare('SHARED_SHUTTLE'),
    },
    currency: 'NGN',
  });
}
