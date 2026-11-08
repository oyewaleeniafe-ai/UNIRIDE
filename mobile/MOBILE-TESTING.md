# CampusCab mobile — build & test report

Date: 2026-11-08

## What is verified

| Check | Command | Result |
| --- | --- | --- |
| Website TypeScript | `npx tsc --noEmit` (repo root) | **pass** (0 errors, before the local `node_modules` was reclaimed for disk space) |
| Website test suite | `npx vitest run` | **pass** — 10 files, 173 tests |
| Mobile TypeScript | `npx tsc --noEmit` (`mobile/`) | **pass** (0 errors) |
| Expo config / dependency health | `npx expo-doctor` | **pass** — 20/20 checks |
| Android JS bundle | `npx expo export --platform android` | **pass** — Hermes bundle 3.2 MB |
| iOS JS bundle | `npx expo export --platform ios` | **pass** — Hermes bundle 3.2 MB |

The Metro export is a full production bundle of every route and component, so it
proves the app's imports, JSX, navigation tree and native module wiring all
resolve for both platforms.

## What is NOT verified yet (and why)

These need a running backend and a real device/build; both were blocked in this
environment. Do not treat them as tested.

1. **Live API round-trips** — the mobile API routes are new and only exist after
   the backend is redeployed. They cannot be exercised until the Next.js app is
   deployed again (Vercel) or run locally.
2. **On-device UI interaction** — no Android emulator, Android SDK or Mac is
   installed on this Windows machine, and installing an emulator needs several GB
   of free disk (the drive had < 300 MB free).
3. **Flutterwave checkout success** — the production secret key currently gets
   `HTTP 400 "One or more required parameters missing"` from Flutterwave's
   `/v3/payments` for the *website* too. Mobile inherits that merchant-side issue;
   the app surfaces the server's error message instead of pretending to succeed.
4. **APK / IPA artifacts** — building requires your Expo (EAS) account login.
   The profiles are ready (`eas.json`) but no build was started.

## Reproduce the verification

```powershell
# website (reinstall deps first — they were removed to free disk space)
cd campus-cab-app
npm install
npx tsc --noEmit
npx vitest run

# mobile
cd mobile
npm install
npx tsc --noEmit
npx expo-doctor
npx expo export --platform android
npx expo export --platform ios
```

## End-to-end checklist (run after deploying the backend)

Deploy the backend first (`git push` → Vercel), then confirm the API answers:

```powershell
curl https://campuscab-pi.vercel.app/api/mobile/locations
# expect: {"locations":[...],"fares":{...},"currency":"NGN"}
```

Then, in the app (development build or Expo Go):

**Student**
1. Sign in with an existing student account → lands on Home with real fares.
2. Book → pick two different locations → choose Shared Shuttle → pay.
3. Checkout opens Flutterwave; on return the ride shows **Paid** only if the
   server verified it. Kill the app mid-booking and reopen: the ride is still
   unpaid, and no driver can accept it.
4. Pull-to-refresh Home → active ride appears; open it → timeline, cancel.
5. Complete a ride (driver side) → rate it.
6. Profile → change name/phone → relaunch app → values persist (SecureStore).

**Driver**
1. Sign in with a driver account → Dashboard shows **Offline**.
2. Turn on availability with no completed inspection → the app blocks it and the
   server also refuses (`Complete your vehicle inspection before going online`).
3. Complete the inspection → toggle online → succeeds.
4. Requests tab lists only **paid** rides → Accept → Manage ride → Start →
   Complete.
5. Earnings shows the net amount after the 25% commission, unpaid balance, and
   payout history. Request payment without a verified bank account → server
   refusal is shown verbatim.
6. Bank details → wrong account number → rejected; valid one → account name is
   resolved by Flutterwave and marked Verified.

**Security spot checks**
```powershell
# no token → 401
curl -i https://campuscab-pi.vercel.app/api/mobile/me
# student token on a driver route → 403
curl -i -H "Authorization: Bearer <student-token>" https://campuscab-pi.vercel.app/api/mobile/driver
```

**Offline**
1. Enable airplane mode → banner appears.
2. Try to pay → blocked with a clear message; no confirmation screen appears.
3. Re-enable network → pull to refresh → state recovers.
