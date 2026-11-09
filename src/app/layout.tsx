import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SessionProvider } from "@/components/session-provider";
import ServiceWorkerRegistration from "@/components/service-worker-registration";
import OfflineBanner from "@/components/offline-banner";
import PushNotificationProvider from "@/components/push-notification-provider";
import Footer from "@/components/footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = 'https://campuscab-pi.vercel.app';

export const metadata: Metadata = {
  title: {
    default: 'Campus Cab — University Ride-Hailing Platform',
    template: '%s | Campus Cab',
  },
  description:
    'Book campus cabs, shuttles, and carpools instantly. Safe, affordable transportation for university students and drivers. Track rides in real-time with SOS safety features.',
  keywords: [
    'campus cab',
    'university ride',
    'student transportation',
    'campus shuttle',
    'carpool',
    'ride hailing',
    'student ride book',
  ],
  authors: [{ name: 'Veltrix' }],
  creator: 'Veltrix',
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Campus Cab',
    title: 'Campus Cab — University Ride-Hailing Platform',
    description:
      'Book campus cabs, shuttles, and carpools instantly. Safe, affordable transportation for university students and drivers.',
    images: [
      {
        url: '/og-image.svg',
        width: 1200,
        height: 630,
        alt: 'Campus Cab — University Ride-Hailing Platform',
        type: 'image/svg+xml',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Campus Cab — University Ride-Hailing Platform',
    description:
      'Book campus cabs, shuttles, and carpools instantly. Safe, affordable transportation for university students and drivers.',
    images: ['/og-image.svg'],
    creator: '@veltrix',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  manifest: '/manifest.json',
  applicationName: 'CampusCab',
  appleWebApp: {
    capable: true,
    title: 'CampusCab',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.ico',
  },
  other: {
    'google-site-verification': 'googlee5f34f8e98905347',
    // iOS honours the manifest's display mode, but Safari on older versions
    // still needs this legacy flag to launch without the browser chrome.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Matches the manifest colours so the iOS/Android status bar and splash
  // blend into the app instead of flashing white.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0e15" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        <ServiceWorkerRegistration />
        <OfflineBanner />
        <ThemeProvider>
          <SessionProvider>
            <PushNotificationProvider>
              <div className="flex flex-col min-h-screen">
                <div className="flex-1">{children}</div>
                <Footer />
              </div>
            </PushNotificationProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
