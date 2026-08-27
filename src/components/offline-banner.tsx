'use client';

import { useOnlineStatus } from '@/hooks/use-online-status';

export default function OfflineBanner() {
  const { isOnline, wasOffline } = useOnlineStatus();

  if (isOnline && !wasOffline) return null;

  if (isOnline && wasOffline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-green-600 text-white text-center py-2 px-4 text-sm font-medium transition-all">
        ✓ Connection restored
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-black text-center py-2 px-4 text-sm font-medium">
      ⚠ You are offline — some features may be limited
    </div>
  );
}
