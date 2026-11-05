import { sandboxEnabled, markSandboxSessionPaid, getSandboxSession } from '@/lib/payments/sandbox';

export const dynamic = 'force-dynamic';

/**
 * Development-only mock of Flutterwave's hosted checkout.
 * Returns 404 unless FLUTTERWAVE_SANDBOX=1 and NODE_ENV !== 'production'.
 */
export async function GET(request: Request) {
  if (!sandboxEnabled()) {
    return new Response('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const reference = url.searchParams.get('reference') ?? '';
  const session = getSandboxSession(reference);

  if (!session) {
    return new Response('Sandbox checkout session not found. Start the booking again.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const amount = session.amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flutterwave Sandbox Checkout — CampusCab</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background:#0f1115; color:#e8eaed;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .card { background:#171a21; border:1px solid #2a2f3a; border-radius:16px; padding:28px;
          width:min(92vw, 380px); box-shadow:0 12px 40px rgba(0,0,0,.45); }
  .badge { display:inline-block; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
           color:#f5a623; border:1px solid #f5a62355; border-radius:999px; padding:4px 10px; }
  h1 { font-size:18px; margin:16px 0 4px; }
  p { color:#9aa3b2; font-size:13px; line-height:1.5; margin:0; }
  .amount { font-size:32px; font-weight:700; margin:20px 0 4px; }
  button { width:100%; margin-top:22px; padding:13px; border-radius:12px; border:0;
           background:#2f7d32; color:#fff; font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#369a3a; }
  code { font-size:11px; color:#7d8698; word-break:break-all; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">Sandbox — no real money</span>
    <h1>CampusCab ride payment</h1>
    <p>Local development checkout. This simulates Flutterwave confirming the charge.</p>
    <div class="amount">₦${amount}</div>
    <p>Reference: <code>${reference.replace(/[<>&"]/g, '')}</code></p>
    <form method="POST">
      <input type="hidden" name="reference" value="${reference.replace(/"/g, '&quot;')}" />
      <button type="submit">Pay ₦${amount} (simulated)</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request) {
  if (!sandboxEnabled()) {
    return new Response('Not found', { status: 404 });
  }

  const form = await request.formData();
  const reference = String(form.get('reference') ?? '');
  const session = markSandboxSessionPaid(reference);

  if (!session) {
    return new Response('Sandbox checkout session not found.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // Rejoin the real verification path exactly like Flutterwave's redirect_url.
  const origin = new URL(request.url).origin;
  return Response.redirect(
    `${origin}/api/payments/verify?reference=${encodeURIComponent(reference)}`,
    303
  );
}
