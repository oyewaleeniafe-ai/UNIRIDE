# Campus Cab

A production-ready university transportation platform connecting students with campus cab drivers, shuttle operators, and carpool drivers.

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Backend**: Next.js Server Actions & API Routes
- **Database**: Neon PostgreSQL via Prisma ORM
- **Auth**: NextAuth.js v5 (Credentials Provider)
- **Validation**: Zod
- **Mobile**: Capacitor 7 (Android & iOS)

## Features

- Student & Driver registration/login
- Role-based route protection (middleware + server-side)
- Campus ride booking with 29 official locations
- Driver dispatch with atomic acceptance (concurrency-safe)
- Vehicle inspection checklist
- Fare splitter (₦200 per student)
- Trip lifecycle: Pending → Accepted → In Progress → Completed
- Real-time notifications
- Ride ratings (1–5 stars)
- SOS emergency alerts with geolocation
- Dark/Light/System theme with persistence
- Responsive mobile-first design with bottom nav
- PWA-ready manifest
- Native Android & iOS apps via Capacitor

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

You need:
- **DATABASE_URL** — Your Neon PostgreSQL connection string
- **AUTH_SECRET** — Generate with `openssl rand -base64 32`
- **NEXT_PUBLIC_APP_URL** — Your app URL (e.g., `http://localhost:3000`)

### 3. Set up database

```bash
npx prisma db push
npx prisma db seed
```

### 4. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Build for production (web)

```bash
npm run build
npm start
```

## Database Schema

Models: User, Student, Driver, Vehicle, Trip, TripPassenger, CampusLocation, VehicleInspection, Notification, SafetyAlert, RideStatusHistory, Rating, UserPreference

## Campus Locations

29 official university locations are seeded. These are the only valid pickup/drop-off points.

## Payments

CampusCab uses **Flutterwave Standard (hosted checkout)** as the only payment provider.

- Amounts are always calculated server-side from the trip's ride type (`SOLO_QUICK_CAB` = ₦800 + ₦10, `SHARED_SHUTTLE` = ₦200 + ₦10). The frontend never controls the amount.
- Each payment gets a unique `tx_ref` (`ccab-...`).
- On success, the student is redirected to `/api/payments/verify?reference=<tx_ref>`, which re-verifies the transaction with Flutterwave before confirming the booking.
- A webhook (`/api/payments/webhook`, POST) is also supported for async confirmation. It validates the `verif-hash` header against `FLUTTERWAVE_WEBHOOK_SECRET` and re-verifies against the Flutterwave API before updating state.
- Pending, failed, cancelled, and expired payments are handled explicitly; a frontend redirect alone is never treated as proof of payment.

### Environment variables

Add these to `.env` (copy from `.env.example`):

```bash
FLUTTERWAVE_SECRET_KEY="FLWXXXXXXXX"
FLUTTERWAVE_WEBHOOK_SECRET="your_webhook_secret_hash"
FLUTTERWAVE_TRANSFERS_ENABLED=
```

- `FLUTTERWAVE_SECRET_KEY` — from the Flutterwave dashboard Settings → API keys.
- `FLUTTERWAVE_WEBHOOK_SECRET` — the secret hash you set in Settings → Webhooks.
- `FLUTTERWAVE_TRANSFERS_ENABLED` — leave empty unless driver payouts are approved on the merchant account.

### Flutterwave dashboard configuration

1. In Settings → Webhooks, add your webhook URL: `https://campuscab-pi.vercel.app/api/payments/webhook`
2. Enable all payment event checkboxes, then save.
3. Set your webhook **secret hash** (`FLUTTERWAVE_WEBHOOK_SECRET`) and note it.
4. Keep `NEXT_PUBLIC_APP_URL` matching your deployed URL so checkout redirects land correctly.

### Driver payouts

Payouts use Flutterwave bank transfers (`POST /v3/transfers`). They are **not automatic**:

- Payouts are only initiated for completed trips with a successful payment on file.
- Only the assigned driver or an admin may initiate the payout.
- Payouts require `FLUTTERWAVE_TRANSFERS_ENABLED=1` **and** a Flutterwave merchant account that is approved for transfers (KYC, server IP whitelist, Transfers API enabled).
- If transfers are not enabled, payout initiation returns an explicit error — it never quietly succeeds or fabricates a transfer.
- Duplicate transfers are prevented because each payout is tied to one payment and one trip.

> Payment collection does **not** automatically enable payouts. If your Flutterwave account isn't approved for transfers, driver payouts will return an error until the merchant approval is in place.

## Deployment

### Web (Vercel/Netlify)

1. Push to GitHub
2. Import in Vercel
3. Set environment variables
4. Deploy

### Mobile (Capacitor — Android & iOS)

#### Prerequisites

- **Android**: Android Studio installed
- **iOS**: Xcode installed (macOS only), CocoaPods
- Your web app deployed (or running locally)

#### Quick Start

```bash
# Build web app and sync to native projects
npm run mobile:build

# Open in Android Studio
npm run cap:open:android

# Open in Xcode (macOS only)
npm run cap:open:ios
```

#### Step-by-Step Mobile Build

1. **Configure the server URL** in `capacitor.config.json`:
   ```json
   "server": {
     "url": "https://your-deployed-app.vercel.app",
     "cleartext": false
   }
   ```
   For local development, use `http://YOUR_LOCAL_IP:3000` (not localhost).

2. **Build and sync**:
   ```bash
   npm run build
   npx cap sync
   ```

3. **Open the platform IDE**:
   ```bash
   # Android
   npx cap open android

   # iOS
   npx cap open ios
   ```

4. **Build and run from the IDE**:
   - **Android Studio**: Click ▶️ Run or Build → Build APK
   - **Xcode**: Select a simulator/device, click ▶️ Run, or Product → Archive for App Store

#### Android Configuration

- **Package name**: `com.campuscab.ridebook`
- **Min SDK**: API 22 (Android 5.1)
- **Target SDK**: API 34 (Android 14)
- **Permissions**: Internet, Location, Camera
- **Output**: APK (for sideloading) or AAB (for Play Store)

To generate a signed APK:
1. In Android Studio: Build → Generate Signed Bundle / APK
2. Create or select a keystore
3. Choose release build type
4. APK will be in `android/app/build/outputs/apk/release/`

#### iOS Configuration

- **Bundle ID**: `com.campuscab.ridebook`
- **Deployment Target**: iOS 13.0
- **Output**: IPA (for App Store or TestFlight)

To build for iOS:
1. Open in Xcode: `npx cap open ios`
2. Select your team under Signing & Capabilities
3. Product → Archive
4. Distribute App → App Store Connect (or Development)

#### Updating the App

After making web code changes:

```bash
npm run build
npx cap sync
# Then rebuild from Android Studio or Xcode
```

#### App Icons

Generate icon placeholders:
```bash
npm run generate:icons
```

For production icons, replace the generated files with properly sized PNGs:
- **Android**: 48, 72, 96, 144, 192 px in respective mipmap folders
- **iOS**: 1024x1024 PNG for AppStore, various sizes for app icon set

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Build Next.js for production |
| `npm start` | Start production server |
| `npm run db:push` | Push schema to database |
| `npm run db:seed` | Seed campus locations |
| `npm run mobile:build` | Build web + sync to Capacitor |
| `npm run mobile:android` | Build, sync, open Android Studio |
| `npm run mobile:ios` | Build, sync, open Xcode |
| `npm run cap:sync` | Sync web assets to native projects |
| `npm run cap:open:android` | Open project in Android Studio |
| `npm run cap:open:ios` | Open project in Xcode |

## License

MIT


<!-- vercel-redeploy-trigger -->
