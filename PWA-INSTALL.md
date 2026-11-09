# CampusCab — install on your phone

Live app: **https://campuscab-pi.vercel.app**

Two ways to use CampusCab on a phone:

| Phone | How to install | File needed |
| --- | --- | --- |
| **iPhone** | Safari → Share → **Add to Home Screen** | none |
| **Android** | Chrome → **Install app**, or install the APK | `campuscab-1.0.0.apk` |

---

## iPhone (no App Store, no Apple Developer account)

The iPhone app is a Progressive Web App served by the same Next.js site, with the
same login, fares, rides and payments as the website.

1. Open **Safari** on the iPhone (Chrome/Firefox on iOS cannot add to the home screen).
2. Go to **https://campuscab-pi.vercel.app**
3. Tap the **Share** button (square with an arrow, bottom of the screen).
4. Scroll down and tap **Add to Home Screen**.
5. Name it **CampusCab** → tap **Add**.

A blue CampusCab icon appears on the home screen. Open it from there and it launches
full-screen in its own window — no Safari address bar, no tabs.

**Signing in:** sign in once inside the installed app. The session cookie is kept by
iOS, so reopening the app from the home screen keeps you signed in until you sign
out or the session expires. (If Safari's "Block All Cookies" is enabled, sessions
will not persist — leave it off.)

**Tips**
- Requires iOS 16.4 or newer for the best experience (16.4 is also the minimum for
  web push). It still runs on older iOS as a home-screen web app.
- Pull down inside the app to refresh ride status; there is no pull-to-refresh bounce.
- If it ever looks out of date, close the app from the app switcher and reopen it —
  the service worker checks for a new version on launch.

---

## Android

**Option A — Chrome install (no file needed)**
1. Open **https://campuscab-pi.vercel.app** in Chrome.
2. Tap the **⋮** menu → **Install app** (or "Add to Home screen").
3. Confirm. It opens standalone from the home screen.

**Option B — the APK (native app, no Play Store)**

1. Copy `campuscab-1.0.0.apk` to the phone (USB cable, or send it to yourself and
   download it on the phone).
2. Open the file. Android asks to allow "Install unknown apps" for the app you are
   opening it from — allow it for that app only.
3. Tap **Install**, then **Open**.

Size 90 MB (94,331,290 bytes), version 1.0.0, package `com.campuscab.app`.
SHA-256 `048ef70908fa7d46931e478493772ccaec56e24a953dcc1a6ef64c7c6e485501` — on
Windows check it with `certutil -hashfile campuscab-1.0.0.apk SHA256`.

The "unknown source" warning is expected: this build is distributed directly, not
through Play.

---

## What works offline (and what must never "work" offline)

Cached: the app shell, brand icons and the offline page — enough to open the app
and see a clear "you're offline" screen.

Never cached, never faked offline:

- `/api/*` — every auth, fare, location, booking, payment and verification call.
- `/student`, `/driver`, `/admin` pages (private, per-user data).
- Any response marked `Cache-Control: private` or `no-store`.
- Anything that is not a `GET` request.

So with no connection you cannot book, pay for, confirm or cancel a ride. You get
the offline page instead of a stale confirmation — no ride is ever charged or
booked from cached data.

---

## Push notifications — status

- **Android (APK):** push notification tokens are stored by the app; delivery
  requires FCM credentials on the backend, which are not configured.
- **iPhone / Android PWA:** the service worker has the `push` and
  `notificationclick` handlers ready, but **web push delivery is not enabled**.
  It needs a VAPID key pair (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
  `VAPID_SUBJECT`), a `web-push` sender in the backend, and a subscribe step in the
  app. None of those are configured, so **no web push notifications are sent**.

In-app notifications (the bell / notifications list) work normally on both
platforms, because they come from the existing backend.

---

## Testing report

Checked against the live deployment after commit `6e3302f`:

| Check | Result |
| --- | --- |
| `/manifest.json` | 200 `application/json` — name `CampusCab`, display `standalone`, 3 icons, theme `#4338ca` |
| `/sw.js` | 200 `application/javascript`, 6,082 bytes, `node --check` passes |
| `/offline.html` | 200 `text/html`, 3,010 bytes |
| `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`, `/apple-touch-icon.png` | 200 `image/png` (1.5 KB / 5.8 KB / 4.9 KB / 1.4 KB), valid PNG headers |
| Icon artwork | rendered and visually checked: indigo `#4338ca` tile, white `CC` and ride bar |
| `<head>` of `/login` | `link rel=manifest`, `link rel=apple-touch-icon` (180×180), `meta application-name=CampusCab`, `meta apple-mobile-web-app-title`, `meta apple-mobile-web-app-status-bar-style`, `meta theme-color` (light + dark) |
| Root redirect | `/` → 307 `/login` (unchanged) |
| Auth guard | `/student/book` and `/driver/dashboard` → 307 to login with `callbackUrl` (unchanged) |
| Website regression | login page renders; no API or route behaviour changed |

Not verified here (no hardware or credentials available on this machine):

- Installing on a physical iPhone or Android phone — this is the step for the first
  Bowen student to try, and the fastest way to find an iOS-only layout bug.
- Web push (not enabled, see above).
- A local `next build`: the website's `node_modules` were removed earlier to free
  disk (the drive has < 1 GB free), so the deployment build on Vercel was the
  compile check. It succeeded — the new manifest, service worker and icons are
  serving from production.
