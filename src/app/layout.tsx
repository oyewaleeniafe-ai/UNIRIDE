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

export const metadata: Metadata = {
  title: "Campus Cab & Shuttle RideBook",
  description: "University transportation platform — book campus cabs, shuttles, and carpools",
  manifest: "/manifest.json",
  other: {
    "google-site-verification": "googlee5f34f8e98905347",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fa" },
    { media: "(prefers-color-scheme: dark)", color: "#111318" },
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
