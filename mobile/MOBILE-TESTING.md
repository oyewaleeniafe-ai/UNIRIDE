# CampusCab mobile — build & test report

Date: 2026-11-09 (APK build added)

## What is verified

| Check | Command | Result |
| --- | --- | --- |
| Website TypeScript | `npx tsc --noEmit` (repo root) | **pass** (0 errors, before the local `node_modules` was reclaimed for disk space) |
| Website test suite | `npx vitest run` | **pass** — 10 files, 173 tests |
| Mobile TypeScript | `npx tsc --noEmit` (`mobile/`) | **pass** (0 errors) |
| Expo config / dependency health | `npx expo-doctor` | **pass** — 20/20 checks |
| Android JS bundle | `npx expo export --platform android` | **pass** — Hermes bundle 3.2 MB |
| iOS JS bundle | `npx expo export --platform ios` | **pass** — Hermes bundle 3.2 MB |
| Live mobile API | `node scripts/mobile-api-check.mjs` | **pass** — 12/12 checks on `campuscab-pi.vercel.app` |
| Android APK | `eas build -p android -e preview` | **pass** — APK built on EAS, downloaded and integrity-checked (details below) |

### Live API checks (after deploying `c47be9b`)

```
PASS  GET  /api/mobile/locations — 29 locations, solo ₦810, shared ₦210
PASS  GET  /api/mobile/banks — 27 banks
PASS  GET  /api/mobile/me without token — 401
PASS  POST /api/mobile/auth/login — role STUDENT
PASS  GET  /api/mobile/me — real student profile (PAY/2026/00991)
PASS  GET  /api/mobile/driver as student — 403
PASS  POST /api/mobile/trips rejects invalid locations — 400
PASS  GET  /api/mobile/trips?scope=active — 3 active
PASS  GET  /api/mobile/trips?scope=history — 0 rides
PASS  GET  /api/mobile/notifications — 0 items
PASS  POST /api/mobile/payments verify unknown reference — 400
PASS  GET  /api/payments/mobile-return — campuscab://payment?…
```

The website still serves normally (`/login` 200; `/` and `/student/book` redirect to
login with 307 when signed out).

Re-run any time:

```powershell
$env:CHECK_EMAIL="you@example.com"; $env:CHECK_PASSWORD="…"
node scripts/mobile-api-check.mjs
```

The Metro export is a full production bundle of every route and component, so it
proves the app's imports, JSX, navigation tree and native module wiring all
resolve for both platforms.

## What is NOT verified yet (and why)

These need a running backend and a real device/build; both were blocked in this
environment. Do not treat them as tested.

1. **Authenticated write flows** (booking → checkout → accept → complete, payout)
   were not exercised on the live API: no driver credentials were available here,
   and payments are blocked by the Flutterwave merchant error below. The read and
   guard paths in the table above are verified.
2. **On-device UI interaction** — no Android emulator, Android SDK or Mac is
   installed on this Windows machine, and installing an emulator needs several GB
   of free disk (the drive had < 300 MB free).
3. **Flutterwave checkout success** — the production secret key currently gets
   `HTTP 400 "One or more required parameters missing"` from Flutterwave's
   `/v3/payments` for the *website* too. Mobile inherits that merchant-side issue;
   the app surfaces the server's error message instead of pretending to succeed.
4. **On-device run of the APK** — the APK now exists (see below) but it has not
   been installed on a physical Android phone here; the checklist further down is
   for you to run on your device.
5. **iOS build** — configured, but no Apple Developer account was supplied, so no
   installable iOS artifact could be produced. See the iOS section below for
   exactly what is missing.

## Android APK (built)

| Item | Value |
| --- | --- |
| Build ID | `afa4463f-8990-4658-9932-a1a5a9b887bb` (finished, EAS cloud build) |
| Profile | `preview` — APK, internal distribution |
| Commit built | `66ebc673a7bb4041077dc36399e10beeb3127419` |
| Package / version | `com.campuscab.app`, versionName `1.0.0`, versionCode `1` |
| SDK | Expo SDK 58.0.0 (React Native 0.88.1 / React 19.3.0) |
| Local file | `mobile/dist/campuscab-1.0.0.apk` (94,331,290 bytes) |
| SHA-256 | `048ef70908fa7d46931e478493772ccaec56e24a953dcc1a6ef64c7c6e485501` |
| EAS artifact | https://expo.dev/artifacts/eas/Kn_Em1WEyh2EcBPnIfespR0ky5cmSqnJKztk7jrIKUE.apk |
| Build page | https://expo.dev/accounts/veltrix16/projects/campuscab/builds/afa4463f-8990-4658-9932-a1a5a9b887bb |

Verified on the file itself: ZIP integrity (`unzip -t`) passes, APK Signing Block
present (v2 signing, key stored on EAS), `AndroidManifest.xml` + `classes.dex` +
Hermes `assets/index.android.bundle` present, bundle contains
`EXPO_PUBLIC_API_URL=https://campuscab-pi.vercel.app` and the `campuscab` scheme.

The APK side-loads over USB (`adb install -r dist/campuscab-1.0.0.apk`) or by
copying it to the phone and opening it with "Install unknown apps" allowed.
Android will warn that the app is from an unknown source because it is internally
distributed, not from Play.

Rebuild or make the Play bundle:

```powershell
cd mobile
npx eas-cli build -p android -e preview      # APK, internal testing
npx eas-cli build -p android -e production   # AAB for Google Play
eas build:list --platform android --limit 5  # check status without waiting
eas build:download --id <build-id>           # fetch an artifact later
```

## iOS (configured; native project verified to compile)

There is **no `.ipa` yet**, and none can be produced without your Apple Developer
Program membership. That is an Apple requirement, not a code gap: installing any
app on a physical iPhone requires a signed build tied to an Apple team, and EAS
needs that team's credentials to sign one.

What is already in place:

| Item | Where |
| --- | --- |
| Bundle identifier `com.campuscab.app`, buildNumber 1 | `app.json` → `ios` |
| Location / camera / photo-library permission strings (App Store rejects missing ones) | `app.json` → `ios.infoPlist` |
| `ITSAppUsesNonExemptEncryption = false` (avoids the export-compliance question on every upload) | `app.json` → `ios.config` |
| iPhone-only (`supportsTablet: false`), portrait, light/dark automatic | `app.json` |
| Deep link scheme `campuscab` | `app.json` → `scheme` |
| Push notifications via `expo-notifications` (needs an APNs key, below) | `app.json` → `plugins` |
| iOS JS bundle compiles | `npx expo export --platform ios` — pass, 3.2 MB Hermes bundle |
| `production` profile (App Store `.ipa`), `preview` (ad-hoc to your devices), `ios-simulator` (no Apple account needed) | `eas.json` |
| Submit placeholders `appleId` / `ascAppId` / `appleTeamId` | `eas.json` → `submit.production.ios` |

### Simulator build (proves the native iOS project compiles)

| Item | Value |
| --- | --- |
| Build ID | `64480c5c-3ca4-4397-bb24-afec1cc2dca1` — **FINISHED** |
| Profile | `ios-simulator` (`ios.simulator: true`, no Apple account used) |
| Commit | `66ebc673a7bb4041077dc36399e10beeb3127419` |
| Xcode invocation | `xcodebuild -workspace CampusCab.xcworkspace -scheme CampusCab -configuration Release -destination "generic/platform=iOS Simulator"` |
| Architectures | arm64 + x86_64 (Pods target and `CampusCab` app target both compiled) |
| Result | `** BUILD SUCCEEDED **`, 0 `error:` / `fatal error:` lines in the xcodebuild log |
| Build page | https://expo.dev/accounts/veltrix16/projects/campuscab/builds/64480c5c-3ca4-4397-bb24-afec1cc2dca1 |

What this proves: the generated iOS project — CocoaPods, `Info.plist`, app target,
config plugins — compiles cleanly for both simulator architectures. The native iOS
side is sound, not just the JS bundle. What it does **not** prove: code signing,
APNs entitlements, or any behaviour on a physical iPhone — all of that needs the
Apple account below.

The `.tar.gz` artifact contains a simulator `CampusCab.app`. It only runs inside
Xcode's iOS Simulator on a Mac, so it is not installable on your Windows machine
or on an iPhone. Download it from the build page (the direct artifact URL answers
`BUILD_NOT_FOUND` to a plain `curl`).

### What you must supply

1. An **Apple Developer Program membership** (US$99/year). A free Apple ID cannot
   make an installable build; it only allows 7-day personal-team signing in Xcode.
2. Your **Apple ID email** and **Team ID** (App Store Connect → Membership).
3. For push notifications on iOS: an **APNs key** created in the Apple Developer
   portal, uploaded once with `npx eas-cli credentials -p ios`.
4. For App Store submission: an app record in App Store Connect (gives you
   `ascAppId`), then replace the three `REPLACE_WITH_…` values in `eas.json`.

### Then, in this order

```powershell
cd mobile
npx eas-cli login                                     # already done (veltrix16)
npx eas-cli build -p ios -e preview                   # asks for your Apple ID; registers your iPhone
npx eas-cli device:create                             # add another iPhone to the ad-hoc list
npx eas-cli build -p ios -e production                # .ipa for App Store
npx eas-cli submit -p ios -e production               # needs ascAppId + appleTeamId
```

EAS will offer to create the distribution certificate and provisioning profile
for you when it asks for your Apple ID — say yes, and let it store them.

### Without an Apple account

`npx eas-cli build -p ios -e ios-simulator` builds a simulator `.app` with no
Apple credentials at all, but it only runs inside Xcode's iOS Simulator, which
requires a Mac. On this Windows machine it cannot be run, so it is not a
substitute for a device build.

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
