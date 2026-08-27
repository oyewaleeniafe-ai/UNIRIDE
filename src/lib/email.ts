import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.EMAIL_FROM || 'Campus Cab <notifications@campuscab.app>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// ─── Email Templates ──────────────────────────────────

function baseTemplate(title: string, content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#1a56db;color:white;padding:16px 20px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:18px;font-weight:600;">Campus Cab</h1>
      <p style="margin:4px 0 0;font-size:12px;opacity:0.8;">RideBook</p>
    </div>
    <div style="background:white;padding:24px;border:1px solid #dee2e6;border-top:none;border-radius:0 0 8px 8px;">
      <h2 style="margin:0 0 16px;font-size:16px;color:#1a1a1a;">${title}</h2>
      ${content}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #dee2e6;">
        <p style="margin:0;font-size:12px;color:#6c757d;">
          Campus Cab & Shuttle RideBook — University Transportation<br>
          <a href="${APP_URL}" style="color:#1a56db;text-decoration:none;">Open RideBook</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function row(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f1f3;">
    <span style="color:#6c757d;font-size:14px;">${label}</span>
    <span style="color:#1a1a1a;font-size:14px;font-weight:500;">${value}</span>
  </div>`;
}

// ─── Send Functions ───────────────────────────────────

export async function sendRideAcceptedEmail(data: {
  to: string;
  studentName: string;
  driverName: string;
  pickup: string;
  dropoff: string;
  passengerCount: number;
  fare: number;
}) {
  if (!resend) {
    console.log('[EMAIL] Resend not configured — skipping ride accepted email');
    return;
  }

  const content = `
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Hi ${data.studentName},</p>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Your ride has been accepted by a driver.</p>
    <div style="background:#f8f9fa;border-radius:6px;padding:12px;margin:0 0 16px;">
      ${row('Driver', data.driverName)}
      ${row('Pickup', data.pickup)}
      ${row('Drop-off', data.dropoff)}
      ${row('Passengers', String(data.passengerCount))}
      ${row('Total Fare', `₦${data.fare.toLocaleString()}`)}
    </div>
    <p style="color:#6c757d;font-size:13px;margin:0;">Please be ready at your pickup location.</p>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: data.to,
    subject: `Your ride has been accepted — ${data.pickup} → ${data.dropoff}`,
    html: baseTemplate('Ride Accepted ✓', content),
  });
}

export async function sendRideCompletedEmail(data: {
  to: string;
  studentName: string;
  driverName: string;
  pickup: string;
  dropoff: string;
  passengerCount: number;
  fare: number;
}) {
  if (!resend) {
    console.log('[EMAIL] Resend not configured — skipping ride completed email');
    return;
  }

  const content = `
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Hi ${data.studentName},</p>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Your ride has been completed. Thank you for riding with Campus Cab!</p>
    <div style="background:#f8f9fa;border-radius:6px;padding:12px;margin:0 0 16px;">
      ${row('Driver', data.driverName)}
      ${row('Pickup', data.pickup)}
      ${row('Drop-off', data.dropoff)}
      ${row('Passengers', String(data.passengerCount))}
      ${row('Total Fare', `₦${data.fare.toLocaleString()}`)}
    </div>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 8px;">We'd love your feedback! Rate your driver in the app.</p>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: data.to,
    subject: `Ride completed — ${data.pickup} → ${data.dropoff}`,
    html: baseTemplate('Ride Completed ✓', content),
  });
}

export async function sendRideCancelledEmail(data: {
  to: string;
  recipientName: string;
  cancelledBy: 'student' | 'driver';
  pickup: string;
  dropoff: string;
}) {
  if (!resend) {
    console.log('[EMAIL] Resend not configured — skipping ride cancelled email');
    return;
  }

  const content = `
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Hi ${data.recipientName},</p>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">A ride from <strong>${data.pickup}</strong> to <strong>${data.dropoff}</strong> has been cancelled by the ${data.cancelledBy}.</p>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: data.to,
    subject: `Ride cancelled — ${data.pickup} → ${data.dropoff}`,
    html: baseTemplate('Ride Cancelled', content),
  });
}

export async function sendRideStartedEmail(data: {
  to: string;
  studentName: string;
  driverName: string;
  pickup: string;
  dropoff: string;
}) {
  if (!resend) {
    console.log('[EMAIL] Resend not configured — skipping ride started email');
    return;
  }

  const content = `
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Hi ${data.studentName},</p>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Your ride with <strong>${data.driverName}</strong> has started.</p>
    <div style="background:#f8f9fa;border-radius:6px;padding:12px;margin:0 0 16px;">
      ${row('From', data.pickup)}
      ${row('To', data.dropoff)}
    </div>
    <p style="color:#6c757d;font-size:13px;margin:0;">If you feel unsafe at any point, use the SOS button in the app.</p>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: data.to,
    subject: `Ride started — ${data.pickup} → ${data.dropoff}`,
    html: baseTemplate('Ride Started 🚗', content),
  });
}

export async function sendSOSAlertEmail(data: {
  to: string;
  userName: string;
  userEmail: string;
  pickup?: string;
  dropoff?: string;
  latitude?: number;
  longitude?: number;
  timestamp: string;
}) {
  if (!resend) {
    console.log('[EMAIL] Resend not configured — skipping SOS alert email');
    return;
  }

  const locationInfo = data.latitude && data.longitude
    ? `<p style="color:#1a1a1a;font-size:14px;margin:0 0 8px;"><strong>Location:</strong> ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}</p>
       <p style="margin:0 0 16px;"><a href="https://www.google.com/maps?q=${data.latitude},${data.longitude}" style="color:#dc3545;font-size:13px;">Open in Google Maps</a></p>`
    : '<p style="color:#6c757d;font-size:13px;margin:0 0 16px;">Location unavailable.</p>';

  const tripInfo = data.pickup && data.dropoff
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;margin:0 0 16px;">
        <p style="color:#dc3545;font-size:13px;font-weight:600;margin:0 0 8px;">Active Ride Information</p>
        ${row('Pickup', data.pickup)}
        ${row('Drop-off', data.dropoff)}
      </div>`
    : '';

  const content = `
    <div style="background:#dc3545;color:white;padding:12px 16px;border-radius:6px;margin:0 0 16px;">
      <p style="margin:0;font-size:16px;font-weight:600;">⚠ EMERGENCY SOS ALERT</p>
    </div>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 8px;"><strong>${data.userName}</strong> has triggered an emergency SOS alert.</p>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 8px;"><strong>Email:</strong> ${data.userEmail}</p>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 8px;"><strong>Time:</strong> ${data.timestamp}</p>
    ${locationInfo}
    ${tripInfo}
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;margin:0 0 16px;">
      <p style="color:#dc3545;font-size:13px;font-weight:600;margin:0 0 4px;">Action Required</p>
      <p style="color:#1a1a1a;font-size:13px;margin:0;">Please verify the safety of this user immediately. Contact campus security if necessary.</p>
    </div>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: data.to,
    subject: `⚠ SOS ALERT — ${data.userName} needs assistance`,
    html: baseTemplate('🚨 Emergency SOS Alert', content),
  });
}

// Also send to the student as confirmation
export async function sendSOSConfirmationEmail(data: {
  to: string;
  userName: string;
}) {
  if (!resend) return;

  const content = `
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Hi ${data.userName},</p>
    <p style="color:#1a1a1a;font-size:14px;margin:0 0 16px;">Your emergency SOS alert has been recorded and forwarded to campus security.</p>
    <p style="color:#6c757d;font-size:13px;margin:0;">If you are in immediate danger, please also call campus security directly or local emergency services.</p>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: data.to,
    subject: 'SOS alert recorded — Campus Cab',
    html: baseTemplate('SOS Alert Recorded', content),
  });
}
