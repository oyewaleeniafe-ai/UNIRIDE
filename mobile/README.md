# CampusCab mobile (Expo + React Native)

Native Android and iOS client for the CampusCab platform. It talks to the **same**
Next.js backend, Neon PostgreSQL database, Prisma schema and Flutterwave
integration as the website — there is no second backend and no duplicated data.

```
campus-cab-app/
├─ src/                 existing Next.js website (unchanged behaviour)
│  ├─ app/api/mobile/   JSON API used only by this app
│  └─ lib/mobile/       token auth, service layer, Expo push sender
└─ mobile/              this Expo app (Android + iOS, one codebase)
```

## What the app does

**Students**
- Sign in / sign up / password recovery (security-question flow, same as web)
- Profile, name and phone editing, password change
- Book a ride: campus locations and fares come from the API, never hardcoded
- Solo Cab and Shared Shuttle with the server-calculated fare breakdown
- Flutterwave checkout opened in a browser session, verified server-side
- Live ride status, ride history, rating, cancellation
- Notifications and SOS (with GPS coordinates when permitted)

**Drivers**
- Sign in, profile, vehicle details
- Vehicle inspection checklist — the backend refuses `online` until it passes
- Online/offline switch (also blocked by the backend without a passed inspection)
- Paid ride requests, accept, start, complete, cancel
- Earnings with university commission deducted, payout history
- Bank account capture with Flutterwave account-name verification, payout request

## Authentication

The website uses next-auth cookies, which React Native cannot rely on. The mobile
API issues its own **HS256 JWT** (`src/lib/mobile/auth.ts`) that the app stores in
`expo-secure-store` (iOS Keychain / Android Keystore).

- The token contains only the user id.
- Every request re-reads the user and its student/driver row from PostgreSQL, so
  deactivated accounts, role changes and deleted profiles take effect immediately.
- Roles are checked server-side from the database — never trusted from the app.
- The token is sent as `Authorization: Bearer <token>`.

## API surface

All routes are JSON, `cache-control: no-store`, and rate-limited per client IP.

| Method | Route | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/mobile/auth/login` | public | credentials → token |
| POST | `/api/mobile/auth/register` | public | student or driver sign-up → token |
| POST | `/api/mobile/auth/recover` | public | `step: identify \| verify \| reset` |
| GET | `/api/mobile/me` | any | profile + student/driver details |
| PATCH | `/api/mobile/me` | any | update name / phone |
| POST | `/api/mobile/me` | any | change password (current password required) |
| GET | `/api/mobile/locations` | any | campus locations + fare table |
| GET | `/api/mobile/trips?scope=active\|history` | student, driver | ride lists |
| POST | `/api/mobile/trips` | student | create a booking (server-calculated fare) |
| GET | `/api/mobile/trips/:id` | owner | ride detail |
| POST | `/api/mobile/trips/:id` | owner | `accept \| start \| complete \| cancel \| rate` |
| GET | `/api/mobile/driver` | driver | dashboard, inspection, earnings, active ride |
| POST | `/api/mobile/driver` | driver | `online \| inspection \| bank \| payout` |
| GET | `/api/mobile/driver/requests` | driver | paid, unassigned rides |
| GET | `/api/mobile/driver/earnings` | driver | earnings, payouts, bank account |
| GET | `/api/mobile/banks` | any | supported payout banks |
| POST | `/api/mobile/payments` | student | `init \| verify` |
| GET | `/api/mobile/notifications` | any | last 40 notifications |
| POST | `/api/mobile/notifications` | any | mark one / all read |
| POST/DELETE | `/api/mobile/push-token` | any | register / unregister Expo push token |
| POST | `/api/mobile/sos` | any | raise a safety alert |
| GET | `/api/payments/mobile-return` | public | Flutterwave return → `campuscab://payment` |

### Business rules preserved

- Fares are calculated on the server from the stored ride type
  (`src/lib/fares.ts`): Shared Shuttle ₦200 + ₦10, Solo Cab ₦800 + ₦10.
- A driver can only accept a ride whose payment is `SUCCESSFUL`.
- Completion requires a successful payment and accrues the commission ledger entry
  exactly once (`accrueEarningForTrip`).
- Going online requires the latest vehicle inspection to be `COMPLETED`.
- Payouts require a verified bank account and `FLUTTERWAVE_TRANSFERS_ENABLED` on
  the server; otherwise the server refuses and the app shows why.
- The app never confirms a ride from a client-side payment result: after checkout
  it calls `verify`, and the server independently verifies with Flutterwave
  (the webhook does the same).

## Payments

1. `POST /api/mobile/trips` creates the trip and payment row (server-side fare).
2. `POST /api/mobile/payments {action:'init'}` returns a Flutterwave checkout URL.
3. The app opens it with `expo-web-browser`.
4. Flutterwave returns to `/api/payments/mobile-return`, which verifies with
   Flutterwave and deep-links to `campuscab://payment?status=...&reference=...`.
5. The app calls `verify` again and reloads the ride. Money state lives only in
   the backend.

No secret key ever ships in the app: the mobile bundle only contains
`EXPO_PUBLIC_API_URL`.

## Environment variables

Only one variable is needed, and it is public:

| Variable | Where | Value |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | app (`.env` / EAS env) | `https://campuscab-pi.vercel.app` |

For local development against a local Next server, use your computer's LAN IP so a
physical phone can reach it:

```bash
# mobile/.env
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
```

Server-side secrets (`DATABASE_URL`, `AUTH_SECRET`, `FLUTTERWAVE_SECRET_KEY`,
`FLUTTERWAVE_WEBHOOK_SECRET`, `FLUTTERWAVE_TRANSFERS_ENABLED`) stay in the
Next.js deployment (Vercel). Never place them in this folder.

## Running locally (Windows)

```powershell
cd mobile
npm install
npx expo start          # press a for Android emulator, or scan the QR with Expo Go
npx tsc --noEmit        # typecheck
npx expo-doctor         # dependency/config health check
```

This app uses `expo-notifications` (remote push), which needs a **development
build** rather than Expo Go on Android. Everything else works in Expo Go.

### Physical device

1. Connect the phone and computer to the same Wi-Fi.
2. Set `EXPO_PUBLIC_API_URL` to the computer's LAN IP (see above).
3. `npx expo start` and scan the QR code.

## Building with EAS (no Android Studio or Mac required)

```powershell
npx eas-cli@latest login
npx eas-cli@latest init            # links the project, writes extra.eas.projectId

# Android development build (installable, talks to Metro)
npx eas-cli@latest build -p android --profile development

# Android APK to sideload (this is the file you install on a phone)
npx eas-cli@latest build -p android --profile preview

# Android App Bundle for Google Play
npx eas-cli@latest build -p android --profile production

# iOS (needs an Apple Developer account for device builds)
npx eas-cli@latest build -p ios --profile production
```

The `preview` profile produces an **APK**; `production` produces an **AAB**.
EAS prints a download URL when the build finishes, and also lists it at
<https://expo.dev/builds>.

Free tier: EAS has a monthly free build allowance and queues non-priority builds.
Every Android artifact above is produced in Expo's cloud, so Windows is enough.

### iOS specifics

- A **free Apple ID** can only run builds on a simulator or through a 7-day
  development provisioning profile; installing on a physical iPhone needs a paid
  Apple Developer Program membership (US$99/year).
- App Store submission always requires that membership plus App Store Connect
  metadata (screenshots, privacy answers, description).
- No Mac is required for EAS builds or submission; `eas submit -p ios` uploads
  the build to App Store Connect.

## Store publishing checklist

**Google Play**
1. Create the app in Play Console (package `com.campuscab.app`).
2. Upload the production AAB (`eas build -p android --profile production`).
3. Complete Data safety, content rating, and privacy policy.
4. Internal testing → closed → production rollout.

**App Store**
1. Create the app record in App Store Connect (bundle `com.campuscab.app`).
2. Fill `eas.json → submit.production.ios` with `appleId`, `ascAppId`, `appleTeamId`.
3. `npx eas-cli@latest submit -p ios --latest`.
4. Add screenshots, privacy details, and submit for review.

## Permissions declared

| Platform | Permission | Why |
| --- | --- | --- |
| iOS | `NSLocationWhenInUseUsageDescription` | pickup point, SOS coordinates |
| iOS | `NSCameraUsageDescription` / photo library | reserved for profile photos |
| Android | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | pickup point, SOS |
| Android | `POST_NOTIFICATIONS` | ride updates |
| Android | `INTERNET`, `VIBRATE` | core app |

Location is requested only when the student taps SOS; denying it still sends the
alert (without coordinates).

## Deep links

Scheme: `campuscab://`

- `campuscab://payment?status=successful&reference=...` — checkout return.

## Offline behaviour

- A persistent banner appears when the device is offline.
- Booking and payment are blocked offline — no fake confirmations are ever shown.
- Lists show an inline error with a retry action instead of stale or invented data.

## Verification performed

See `MOBILE-TESTING.md` in this folder for the exact commands and results.
