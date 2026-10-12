// Captures redesign screenshots for side-by-side refinement against the user's reference images.
// Usage: node scripts/refine-shots.mjs   (dev server must be running)
// Output: campus-cab-app/public/refine/*.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(appRoot, "public", "refine");
mkdirSync(outDir, { recursive: true });

const BASE = process.env.SHOT_BASE_URL || "http://127.0.0.1:53780";

// QA accounts created earlier in this session (exist in the DB the app uses).
const STUDENT = { email: "visualqa.student+bgcheck@campuscab.test", password: "VqaBg2026!" };
const DRIVER = { email: "visualqa.driver+bgcheck@campuscab.test", password: "VqaBg2026!" };

const newPage = async (browser) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  return { ctx, page: await ctx.newPage() };
};

async function setTheme(page, mode) {
  await page.evaluate((m) => {
    document.documentElement.classList.toggle("dark", m === "dark");
    document.documentElement.style.colorScheme = m;
  }, mode);
  await page.waitForTimeout(450);
}

async function shot(page, name) {
  await page.waitForTimeout(1200); // fonts / slideshow / hydration settle
  await page.screenshot({ path: join(outDir, name), fullPage: true });
  console.log("  shot:", name);
}

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2000);
}

async function login(page, email, password) {
  await goto(page, "/login");
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname.includes("dashboard"), { timeout: 30000 });
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch();
const failures = [];

async function section(name, fn) {
  console.log(`\n== ${name} ==`);
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.error(`  FAILED ${name}:`, e.message);
  }
}

try {
  await section("login", async () => {
    const { ctx, page } = await newPage(browser);
    await goto(page, "/login");
    await setTheme(page, "light");
    await shot(page, "login-light.png");
    await setTheme(page, "dark");
    await shot(page, "login-dark.png");
    await ctx.close();
  });

  await section("student", async () => {
    const { ctx, page } = await newPage(browser);
    await login(page, STUDENT.email, STUDENT.password);
    await setTheme(page, "light");
    await shot(page, "student-light.png");
    await goto(page, "/student/book");
    await shot(page, "booking-light.png");
    await goto(page, "/student/dashboard");
    await setTheme(page, "dark");
    await shot(page, "student-dark.png");
    await ctx.close();
  });

  await section("driver", async () => {
    const { ctx, page } = await newPage(browser);
    await login(page, DRIVER.email, DRIVER.password);
    await setTheme(page, "light");
    await shot(page, "driver-light.png");
    await ctx.close();
  });
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} section(s) failed` : "\nall sections ok");
process.exit(failures.length ? 1 : 0);
