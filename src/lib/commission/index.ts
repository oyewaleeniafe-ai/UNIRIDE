/**
 * CampusCab school commission module — public surface.
 *
 * 5% (configurable, snapshot per earning) of each driver's eligible earnings
 * (the verified ride fare — platform fee excluded), accrued on ride
 * completion, aggregated per business day, settled daily via Flutterwave
 * transfers (disabled by default).
 */

export {
  toKobo,
  fromKobo,
  formatKobo,
  commissionKobo,
  netKobo,
  rateBpsToPercent,
} from './money';

export {
  getCommissionConfig,
  updateCommissionConfig,
  hasSchoolRecipient,
  commissionConfigSchema,
  DEFAULT_COMMISSION_RATE_BPS,
  DEFAULT_BUSINESS_TIMEZONE,
} from './config';
export type { CommissionConfigRecord, CommissionConfigInput } from './config';

export {
  businessDayKey,
  businessDayRange,
  previousBusinessDayKey,
  dayKeyToIso,
  isoToDayKey,
  addBusinessDays,
} from './time';

export { accrueEarningForTrip, backfillEarnings, reverseEarningForTrip } from './earnings';
export type { AccrualResult, BackfillResult, ReversalResult } from './earnings';

export {
  getDriverDaySummary,
  getDriverEarningRows,
  getSchoolDaySummary,
  getSchoolGlobalSummary,
  getCommissionByDay,
  getCommissionByDriver,
} from './daily';
export type {
  DriverDaySummary,
  DriverEarningRow,
  SchoolDaySummary,
  SchoolGlobalSummary,
  CommissionDayBucket,
  CommissionByDriverRow,
} from './daily';

export {
  prepareSettlement,
  initiateSettlementTransfer,
  verifySettlement,
  reconcileTransfers,
  cancelSettlement,
  runSettlementCycle,
  settlementRunKey,
} from './settlements';
export type {
  PrepareResult,
  InitiateResult,
  VerifyResult,
  CancelResult,
  CycleResult,
} from './settlements';
