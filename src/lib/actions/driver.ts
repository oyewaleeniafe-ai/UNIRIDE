'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createPayoutForTrip } from '@/lib/payments';
import { findBankByCode } from '@/lib/payments/banks';
import { resolveBankAccount } from '@/lib/payments/flutterwave';
import { logAudit } from '@/lib/audit';

export async function toggleDriverOnline(online: boolean) {
  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  const driver = await prisma.driver.findUnique({
    where: { userId: session.user.id },
    include: { inspections: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  if (!driver) {
    return { error: 'Driver account not found.' };
  }

  if (online) {
    const latestInspection = driver.inspections[0];
    if (!latestInspection || latestInspection.status !== 'COMPLETED') {
      return { error: 'Complete your vehicle inspection before going online.' };
    }
  }

  const updated = await prisma.driver.update({
    where: { id: driver.id },
    data: { isOnline: online },
  });

  return { success: true, isOnline: updated.isOnline };
}

export async function submitInspection(data: {
  brakes: boolean;
  tires: boolean;
  lights: boolean;
  interiorClean: boolean;
  noTrash: boolean;
  fireExtinguisher: boolean;
  firstAidKit: boolean;
  fuelBattery: boolean;
}) {
  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  const driver = await prisma.driver.findUnique({
    where: { userId: session.user.id },
  });

  if (!driver) {
    return { error: 'Driver account not found.' };
  }

  const allPassed =
    data.brakes && data.tires && data.lights && data.interiorClean &&
    data.noTrash && data.fireExtinguisher && data.firstAidKit && data.fuelBattery;

  const inspection = await prisma.vehicleInspection.create({
    data: {
      driverId: driver.id,
      brakes: data.brakes,
      tires: data.tires,
      lights: data.lights,
      interiorClean: data.interiorClean,
      noTrash: data.noTrash,
      fireExtinguisher: data.fireExtinguisher,
      firstAidKit: data.firstAidKit,
      fuelBattery: data.fuelBattery,
      status: allPassed ? 'COMPLETED' : 'DRAFT',
    },
  });

  return { success: true, inspection };
}

const bankDetailsSchema = z.object({
  bankCode: z.string().trim().min(1, 'Select your bank'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Account number must be 10 digits'),
  accountName: z
    .string()
    .trim()
    .min(2, 'Enter the account name')
    .max(100, 'Account name is too long'),
});

/**
 * Save (or replace) the driver's payout bank account.
 *
 * The bank name is resolved from the code server-side, so a client can never
 * pair a trusted code with a misleading name. Details are stored PENDING —
 * Flutterwave verifies the account when the first transfer is created.
 */
export async function saveDriverBankAccount(input: {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}) {
  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  const parsed = bankDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid bank details' };
  }

  const bank = findBankByCode(parsed.data.bankCode);
  if (!bank) {
    return { error: 'Select a supported bank.' };
  }

  const driver = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  if (!driver) {
    return { error: 'Driver account not found.' };
  }

  // Confirm the account belongs to the name the driver typed. Flutterwave's
  // lookup is authoritative: when it answers, its name replaces the typed one
  // and the account is stored VERIFIED. If the lookup cannot run at all (no
  // key / network), the details are still saved but stay PENDING so no money
  // is ever sent to an unverified name.
  const resolution = await resolveBankAccount({
    bankCode: bank.code,
    accountNumber: parsed.data.accountNumber,
  });

  if ('error' in resolution) {
    if (!resolution.unavailable) {
      return { error: `We could not verify this account: ${resolution.error}` };
    }
  }

  const accountName = 'accountName' in resolution ? resolution.accountName : parsed.data.accountName;
  const verificationStatus = 'accountName' in resolution ? 'VERIFIED' : 'PENDING';

  const account = await prisma.driverPaymentAccount.upsert({
    where: { driverId: driver.id },
    update: {
      provider: 'FLUTTERWAVE',
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: parsed.data.accountNumber,
      accountName,
      // A changed account invalidates any provider recipient created before.
      providerRecipientId: null,
      verificationStatus,
      isActive: true,
    },
    create: {
      driverId: driver.id,
      provider: 'FLUTTERWAVE',
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: parsed.data.accountNumber,
      accountName,
      verificationStatus,
      isActive: true,
    },
  });

  logAudit({
    userId: session.user.id,
    action: 'driver.bank_details_updated',
    entity: 'DriverPaymentAccount',
    entityId: account.id,
    details: {
      bankCode: bank.code,
      bankName: bank.name,
      accountLast4: parsed.data.accountNumber.slice(-4),
      verificationStatus,
      nameMatchedTypedValue: accountName.toLowerCase() === parsed.data.accountName.toLowerCase(),
    },
  }).catch(() => {});

  revalidatePath('/driver/earnings');

  return {
    success: true,
    bank: {
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: parsed.data.accountNumber,
      accountName,
      verified: verificationStatus === 'VERIFIED',
    },
  };
}

/**
 * Pay out every unpaid, completed-ride earning to the driver's saved account.
 *
 * Each trip is transferred through the existing payout pipeline, which
 * enforces the Flutterwave transfers flag, the saved recipient account and
 * duplicate protection. When transfers are not enabled nothing is created, so
 * a click can never queue a fake transfer.
 */
export async function requestDriverPayout() {
  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  const driver = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  if (!driver) {
    return { error: 'Driver account not found.' };
  }

  const account = await prisma.driverPaymentAccount.findUnique({
    where: { driverId: driver.id },
  });
  if (!account?.isActive || !account.bankCode || !account.accountNumber) {
    return { error: 'Add your bank account details before requesting a payment.' };
  }

  if (account.verificationStatus !== 'VERIFIED') {
    return {
      error:
        'Your bank account has not been verified yet. Re-save your bank details so we can confirm the account name.',
    };
  }

  const earnings = await prisma.driverEarning.findMany({
    where: { driverId: driver.id, status: 'ACCRUED', payoutStatus: 'UNPAID' },
    select: { tripId: true, paymentId: true, netAmountKobo: true },
    orderBy: { earningDate: 'asc' },
  });

  const withPayment = earnings.filter(
    (e): e is { tripId: string; paymentId: string; netAmountKobo: number } =>
      Boolean(e.paymentId)
  );

  if (withPayment.length === 0) {
    return { error: 'You have no unpaid earnings to request right now.' };
  }

  // Trips that already have an open or successful payout must not be resent.
  const openPayouts = await prisma.payout.findMany({
    where: {
      tripId: { in: withPayment.map((e) => e.tripId) },
      status: { in: ['PENDING', 'PROCESSING', 'SUCCESS'] },
    },
    select: { tripId: true },
  });
  const alreadyPaid = new Set(openPayouts.map((p) => p.tripId));
  const eligible = withPayment.filter((e) => !alreadyPaid.has(e.tripId));

  if (eligible.length === 0) {
    return { error: 'Your earnings are already being processed.' };
  }

  if (!process.env.FLUTTERWAVE_TRANSFERS_ENABLED) {
    return {
      error:
        'Payouts are not live yet — Flutterwave transfers are still being activated. ' +
        'Your balance stays safe and you can request it as soon as transfers are enabled.',
    };
  }

  let paidCount = 0;
  let paidKobo = 0;
  let firstError: string | undefined;

  for (const earning of eligible) {
    const result = await createPayoutForTrip({
      tripId: earning.tripId,
      paymentId: earning.paymentId,
    });

    if ('error' in result && result.error) {
      firstError ??= result.error;
      continue;
    }

    paidCount += 1;
    if (result.status === 'SUCCESS') {
      paidKobo += earning.netAmountKobo;
    }
  }

  logAudit({
    userId: session.user.id,
    action: 'payout.requested',
    entity: 'Payout',
    details: {
      requestedTrips: eligible.length,
      initiated: paidCount,
      totalKobo: eligible.reduce((sum, e) => sum + e.netAmountKobo, 0),
    },
  }).catch(() => {});

  revalidatePath('/driver/earnings');

  if (paidCount === 0) {
    return { error: firstError ?? 'Payment could not be started. Please try again.' };
  }

  return {
    success: true,
    paidCount,
    paidKobo,
    pendingCount: eligible.length - paidCount,
  };
}
