export type Role = 'STUDENT' | 'DRIVER' | 'ADMIN';

export type User = {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: Role;
  profileImage: string | null;
  createdAt?: string;
};

export type Me = {
  user: User;
  student: { matricNo: string; university: string } | null;
  driver: {
    driverCode: string;
    isOnline: boolean;
    rating: number;
    totalTrips: number;
    vehicle: { make: string; model: string; color: string; plate: string } | null;
    inspectionStatus: 'DRAFT' | 'COMPLETED' | null;
  } | null;
};

export type FareBreakdown = { rideFare: number; platformFee: number; totalAmount: number };

export type RideType = 'SOLO_QUICK_CAB' | 'SHARED_SHUTTLE';

export type CampusLocation = { id: string; name: string; lat: number | null; lng: number | null };

export type LocationsResponse = {
  locations: CampusLocation[];
  fares: Record<RideType, FareBreakdown>;
  currency: string;
};

export type TripStatus = 'PENDING' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type Trip = {
  id: string;
  status: TripStatus;
  rideType: RideType;
  passengerCount: number;
  totalFare: number;
  platformFee: number;
  driverEarnings: number;
  pickup: string;
  dropoff: string;
  createdAt: string;
  updatedAt: string;
  driver: {
    name: string;
    phone: string;
    rating: number;
    trips: number;
    vehicle: string | null;
    plate: string | null;
  } | null;
  payment: { status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'ABANDONED'; reference: string; amount: number } | null;
};

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
};

export type DriverSummary = {
  driver: {
    name: string;
    phone: string;
    email: string;
    driverCode: string;
    isOnline: boolean;
    rating: number;
    totalTrips: number;
    vehicle: { make: string; model: string; color: string; plate: string } | null;
  };
  inspection: { id: string; status: 'DRAFT' | 'COMPLETED'; createdAt: string } | null;
  canGoOnline: boolean;
  earnings: { lifetimeKobo: number; unpaidKobo: number; unpaidCount: number };
  bankAccount: {
    bankName: string | null;
    accountNumber: string | null;
    accountName: string | null;
    verified: boolean;
  } | null;
  activeTrip: Trip | null;
  availableRequests: number;
  inspections: Array<{
    id: string;
    status: 'DRAFT' | 'COMPLETED';
    createdAt: string;
    items: Record<string, boolean>;
  }>;
};

export type EarningsResponse = {
  earnings: Array<{
    id: string;
    tripId: string;
    route: string;
    grossKobo: number;
    commissionKobo: number;
    netKobo: number;
    status: 'ACCRUED' | 'REVERSED';
    payoutStatus: 'UNPAID' | 'PAID';
    date: string;
  }>;
  payouts: Array<{
    id: string;
    amount: number;
    status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
    reference: string | null;
    failureReason: string | null;
    createdAt: string;
  }>;
  bankAccount: {
    bankCode: string | null;
    bankName: string | null;
    accountNumber: string | null;
    accountName: string | null;
    verified: boolean;
    verificationStatus: string;
  } | null;
};
