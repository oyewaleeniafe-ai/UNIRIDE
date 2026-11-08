/**
 * Live smoke test for the CampusCab mobile API.
 *
 * Usage: node scripts/mobile-api-check.mjs [baseUrl]
 *
 * Reads credentials from env (never prints tokens):
 *   CHECK_EMAIL / CHECK_PASSWORD
 *
 * Exits non-zero if any check fails.
 */

const BASE = (process.argv[2] || 'https://campuscab-pi.vercel.app').replace(/\/+$/, '');
const EMAIL = process.env.CHECK_EMAIL;
const PASSWORD = process.env.CHECK_PASSWORD;

let failures = 0;
const pass = (name, detail = '') => console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
const fail = (name, detail = '') => {
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function req(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

const main = async () => {
  console.log(`Base: ${BASE}\n`);

  // 1. Public data
  const locations = await req('/api/mobile/locations');
  if (locations.status === 200 && Array.isArray(locations.json?.locations)) {
    pass(
      'GET /api/mobile/locations',
      `${locations.json.locations.length} locations, solo ₦${locations.json.fares.SOLO_QUICK_CAB.totalAmount}, shared ₦${locations.json.fares.SHARED_SHUTTLE.totalAmount}`
    );
  } else {
    fail('GET /api/mobile/locations', `status ${locations.status}`);
  }

  const banks = await req('/api/mobile/banks');
  if (banks.status === 200 && Array.isArray(banks.json?.banks)) {
    pass('GET /api/mobile/banks', `${banks.json.banks.length} banks`);
  } else {
    fail('GET /api/mobile/banks', `status ${banks.status}`);
  }

  // 2. Auth is required
  const anon = await req('/api/mobile/me');
  if (anon.status === 401) pass('GET /api/mobile/me without token', '401');
  else fail('GET /api/mobile/me without token', `expected 401, got ${anon.status}`);

  // 3. Real login
  if (!EMAIL || !PASSWORD) {
    fail('login', 'set CHECK_EMAIL and CHECK_PASSWORD');
    process.exit(1);
  }

  const login = await req('/api/mobile/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });

  if (login.status !== 200 || !login.json?.token) {
    fail('POST /api/mobile/auth/login', login.json?.error || `status ${login.status}`);
    process.exit(1);
  }
  const token = login.json.token;
  pass('POST /api/mobile/auth/login', `role ${login.json.user.role}`);

  // 4. Session profile
  const me = await req('/api/mobile/me', { token });
  if (me.status === 200 && me.json?.user?.email === EMAIL) {
    pass('GET /api/mobile/me', `${me.json.user.name}${me.json.student ? ` · ${me.json.student.matricNo}` : ''}`);
  } else {
    fail('GET /api/mobile/me', `status ${me.status}`);
  }

  // 5. Role enforcement (student token on a driver route)
  const driverRoute = await req('/api/mobile/driver', { token });
  if (driverRoute.status === 403) pass('GET /api/mobile/driver as student', '403');
  else fail('GET /api/mobile/driver as student', `expected 403, got ${driverRoute.status}`);

  // 6. Driver role from a student booking attempt is also rejected
  const badBook = await req('/api/mobile/trips', {
    method: 'POST',
    token,
    body: {
      pickupLocationId: '00000000-0000-0000-0000-000000000000',
      dropoffLocationId: '00000000-0000-0000-0000-000000000001',
      passengerCount: 1,
      rideType: 'SOLO_QUICK_CAB',
    },
  });
  if (badBook.status === 400) pass('POST /api/mobile/trips rejects invalid locations', '400');
  else fail('POST /api/mobile/trips rejects invalid locations', `expected 400, got ${badBook.status}`);

  // 7. Reads that should work for a signed-in student
  const trips = await req('/api/mobile/trips?scope=active', { token });
  if (trips.status === 200 && Array.isArray(trips.json?.trips)) {
    pass('GET /api/mobile/trips?scope=active', `${trips.json.trips.length} active`);
  } else {
    fail('GET /api/mobile/trips?scope=active', `status ${trips.status}`);
  }

  const history = await req('/api/mobile/trips?scope=history', { token });
  if (history.status === 200 && Array.isArray(history.json?.trips)) {
    pass('GET /api/mobile/trips?scope=history', `${history.json.trips.length} rides`);
  } else {
    fail('GET /api/mobile/trips?scope=history', `status ${history.status}`);
  }

  const notifications = await req('/api/mobile/notifications', { token });
  if (notifications.status === 200 && Array.isArray(notifications.json?.notifications)) {
    pass('GET /api/mobile/notifications', `${notifications.json.notifications.length} items`);
  } else {
    fail('GET /api/mobile/notifications', `status ${notifications.status}`);
  }

  // 8. Payment verification refuses unknown references
  const verify = await req('/api/mobile/payments', {
    method: 'POST',
    token,
    body: { action: 'verify', reference: 'ccab-does-not-exist' },
  });
  if (verify.status === 400 || verify.status === 404) {
    pass('POST /api/mobile/payments verify unknown reference', `${verify.status}`);
  } else {
    fail('POST /api/mobile/payments verify unknown reference', `expected 4xx, got ${verify.status}`);
  }

  // 9. Deep-link return route redirects into the app scheme
  const ret = await fetch(`${BASE}/api/payments/mobile-return?tx_ref=ccab-does-not-exist`, {
    redirect: 'manual',
  });
  const location = ret.headers.get('location') || '';
  if (location.startsWith('campuscab://payment')) {
    pass('GET /api/payments/mobile-return', location.replace(/\?.*/, '?…'));
  } else {
    fail('GET /api/payments/mobile-return', `location: ${location || ret.status}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error('Smoke test crashed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
