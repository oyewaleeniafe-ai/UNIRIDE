/**
 * Bootstrap or promote a CampusCab school administrator.
 *
 * The public registration flow only creates STUDENT and DRIVER accounts, so
 * the first ADMIN must be created from the server (or promoted from an
 * existing account). Usage:
 *
 *   node scripts/create-admin.js <email> [password]
 *
 * - With a password: creates the admin, or promotes an existing user with
 *   that email to ADMIN.
 * - Without a password: a strong random password is generated and printed
 *   once to stdout. Store it in a password manager — it is never written to
 *   a file and never appears in logs.
 *
 * Requires DATABASE_URL in the environment (.env is loaded automatically).
 */

const path = require('node:path');
const crypto = require('node:crypto');

// Load .env without adding a dependency (Next.js/Prisma already read it).
try {
  const fs = require('node:fs');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
} catch {
  // .env is optional — DATABASE_URL may come from the environment instead.
}

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const providedPassword = process.argv[3];

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Usage: node scripts/create-admin.js <email> [password]');
    process.exit(1);
  }

  const password = providedPassword || generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN', isActive: true },
    });
    console.log(`Promoted existing user ${email} to ADMIN.`);
    console.log('The password was not changed. Use the password-reset flow if needed.');
  } else {
    await prisma.user.create({
      data: {
        email,
        name: 'School Administrator',
        // `phone` is required by the schema; the admin account never uses it
        // for SMS, so a placeholder is fine and can be edited later.
        phone: `+234${crypto.randomInt(1000000000, 9999999999)}`,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });
    console.log(`Created ADMIN user ${email}.`);
    console.log('Temporary password: ' + password);
    console.log('Sign in and change it immediately.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
