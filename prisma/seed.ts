import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CAMPUS_LOCATIONS = [
  'Old Chapel',
  'COLBS',
  'Clinic',
  'Chemistry Building',
  'Forza',
  'Sadler',
  'Block Hostel',
  'Car Park',
  'Complex',
  'NLT',
  'New Horizon',
  'Chapel Field',
  'Main Field',
  'Library',
  'Senate Building',
  'COHES',
  'COCCS',
  'Agric Field',
  'COLAW',
  'SMS',
  '1500',
  'Boys Hostel',
  'BBSF',
  'Jubilee',
  'Gym',
  'NH',
  '288',
  'UPE',
  'CBT Center',
];

async function main() {
  console.log('Seeding campus locations...');

  for (const name of CAMPUS_LOCATIONS) {
    await prisma.campusLocation.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log(`Seeded ${CAMPUS_LOCATIONS.length} campus locations.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
