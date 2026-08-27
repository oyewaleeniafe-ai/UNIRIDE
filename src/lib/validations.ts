import { z } from 'zod';

// ─── Auth ─────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerStudentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  matricNo: z.string().min(3, 'Matric number is required'),
  phone: z.string().min(10, 'Please enter a valid phone number'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const registerDriverSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  driverId: z.string().min(2, 'Driver ID is required'),
  phone: z.string().min(10, 'Please enter a valid phone number'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  vehicleMake: z.string().min(1, 'Vehicle make is required'),
  vehicleModel: z.string().min(1, 'Vehicle model is required'),
  vehicleColor: z.string().min(1, 'Vehicle color is required'),
  licensePlate: z.string().min(2, 'License plate is required'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

// ─── Booking ──────────────────────────────────────────

export const bookingSchema = z.object({
  pickupLocationId: z.string().uuid('Please select a pickup location'),
  dropoffLocationId: z.string().uuid('Please select a drop-off location'),
  passengerCount: z.number().min(1, 'At least 1 passenger').max(10, 'Maximum 10 passengers'),
  rideType: z.enum(['SOLO_QUICK_CAB', 'SHARED_SHUTTLE', 'LATE_NIGHT_SAFE_RIDE']),
}).refine((data) => data.pickupLocationId !== data.dropoffLocationId, {
  message: 'Pickup and drop-off locations must be different',
  path: ['dropoffLocationId'],
});

// ─── Rating ───────────────────────────────────────────

export const ratingSchema = z.object({
  score: z.number().min(1).max(5),
  feedback: z.string().optional(),
});

// ─── SOS ──────────────────────────────────────────────

export const sosSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  notes: z.string().optional(),
});

// ─── Inspection ───────────────────────────────────────

export const inspectionSchema = z.object({
  brakes: z.boolean().refine((v) => v === true, { message: 'Required' }),
  tires: z.boolean().refine((v) => v === true, { message: 'Required' }),
  lights: z.boolean().refine((v) => v === true, { message: 'Required' }),
  interiorClean: z.boolean().refine((v) => v === true, { message: 'Required' }),
  noTrash: z.boolean().refine((v) => v === true, { message: 'Required' }),
  fireExtinguisher: z.boolean().refine((v) => v === true, { message: 'Required' }),
  firstAidKit: z.boolean().refine((v) => v === true, { message: 'Required' }),
  fuelBattery: z.boolean().refine((v) => v === true, { message: 'Required' }),
});

// ─── Types ────────────────────────────────────────────

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterStudentInput = z.infer<typeof registerStudentSchema>;
export type RegisterDriverInput = z.infer<typeof registerDriverSchema>;
export type BookingInput = z.infer<typeof bookingSchema>;
export type RatingInput = z.infer<typeof ratingSchema>;
export type InspectionInput = z.infer<typeof inspectionSchema>;
