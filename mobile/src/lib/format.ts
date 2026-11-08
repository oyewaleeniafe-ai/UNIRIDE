export function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
}

export function kobo(value: number): string {
  return naira(value / 100);
}

export function shortDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} · ${date.toLocaleTimeString(
    'en-NG',
    { hour: '2-digit', minute: '2-digit' }
  )}`;
}

export function relativeTime(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return shortDate(value);
}

export const rideTypeLabel = (type: string) =>
  type === 'SOLO_QUICK_CAB' ? 'Solo Cab' : type === 'SHARED_SHUTTLE' ? 'Shared Shuttle' : type;

export const statusLabel = (status: string) =>
  ({
    PENDING: 'Waiting for driver',
    ACCEPTED: 'Driver assigned',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    SUCCESSFUL: 'Paid',
    FAILED: 'Failed',
    ABANDONED: 'Payment not completed',
    DRAFT: 'Incomplete',
    ACCRUED: 'Accrued',
    REVERSED: 'Reversed',
    UNPAID: 'Unpaid',
    PAID: 'Paid out',
    PROCESSING: 'Processing',
    SUCCESS: 'Paid',
  })[status] ?? status;

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
