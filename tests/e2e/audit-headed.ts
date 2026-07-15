import { chromium } from "@playwright/test";

const PORT = process.env.PORT ?? 3000;
const BASE = `http://localhost:${PORT}`;

const PAGES = [
  { path: "/login", name: "Login" },
  { path: "/", name: "Home" },
  { path: "/roles", name: "Roles" },
  { path: "/skills", name: "Skills" },
  { path: "/workflows", name: "Workflows" },
  { path: "/evals", name: "Evals" },
  { path: "/strategy", name: "Strategy" },
  { path: "/knowledge", name: "Knowledge" },
  { path: "/settings", name: "Settings" },
];

async function audit() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const errors: Record<string, string[]> = {};

  // Open login page — PAUSE so user can sign in
  console.log("🔑 Opening login page — please sign in manually...");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
  console.log("⏸️  Browser is open. Sign in with Google, then come back here and press ENTER to continue the audit.");

  // Wait for user to finish logging in — detect navigation away from /login
  console.log("⏳ Waiting for you to log in (watching for redirect from /login)...");

  // Wait up to 120 seconds for login
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (!url.includes("/login")) {
      console.log(`✅ Logged in! Redirected to: ${url}`);
      break;
    }
    if (i === 119) {
      console.log("⚠️  Login timeout — continuing anyway with current session.");
    }
  }

  // Small settle time
  await page.waitForTimeout(2000);

  // Now audit every page
  for (const route of PAGES) {
    console.log(`\n🔍 Auditing: ${route.name} (${route.path})`);
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    try {
      await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(1500);

      // Screenshot
      await page.screenshot({
        path: `/Users/shayan/Desktop/Projects/SpielOS/tests/e2e/screenshots/${route.name.toLowerCase()}-audit.png`,
        fullPage: true,
      });

      // Inspect DOM
      const loadingText = await page.locator("text=/loading/i").count();
      const pulseElements = await page.locator(".animate-pulse").count();
      const spinners = await page.locator(".animate-spin").count();

      const inlineColors = await page.evaluate(() => {
        const els = document.querySelectorAll("[style*='color'], [style*='background']");
        return Array.from(els).slice(0, 5).map((el) => el.getAttribute("style") || "");
      });

      console.log(`  ✅ Page loaded`);
      console.log(`  📸 Screenshot saved`);
      console.log(`  ⏳ Loading text: ${loadingText}`);
      console.log(`  💀 Skeletons (pulse): ${pulseElements}`);
      console.log(`  🔄 Spinners: ${spinners}`);
      if (inlineColors.length > 0) {
        console.log(`  ⚠️  Inline colors: ${inlineColors.length}`);
        inlineColors.forEach((c) => console.log(`     ${c}`));
      }

      if (pageErrors.length > 0) {
        errors[route.path] = pageErrors;
        console.log(`  ❌ Console errors: ${pageErrors.length}`);
        pageErrors.forEach((e) => console.log(`     ${e.substring(0, 150)}`));
      } else {
        console.log(`  ✅ No console errors`);
      }

      // Hover nav items
      const navItems = page.locator("nav a, nav button, [role='navigation'] a");
      const navCount = await navItems.count();
      if (navCount > 0) {
        console.log(`  🧭 Nav items: ${navCount}`);
        for (let i = 0; i < Math.min(navCount, 5); i++) {
          await navItems.nth(i).hover();
          await page.waitForTimeout(200);
        }
        console.log(`  ✅ Hover states checked`);
      }

      // Check empty states
      const emptyStates = await page.locator("text=/no .* yet|empty|nothing here/i").count();
      if (emptyStates > 0) {
        console.log(`  📭 Empty state elements: ${emptyStates}`);
      }

    } catch (err: any) {
      console.log(`  ❌ Failed: ${err.message?.substring(0, 120)}`);
    }

    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 FULL AUDIT SUMMARY");
  console.log("=".repeat(60));
  const totalErrors = Object.values(errors).flat().length;
  console.log(`Pages audited: ${PAGES.length}`);
  console.log(`Total console errors: ${totalErrors}`);
  for (const [path, errs] of Object.entries(errors)) {
    console.log(`  ${path}: ${errs.length} errors`);
    errs.forEach((e) => console.log(`    ${e.substring(0, 200)}`));
  }
  console.log("=".repeat(60));

  await browser.close();
}

audit().catch(console.error);
