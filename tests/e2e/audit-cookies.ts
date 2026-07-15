import { chromium } from "@playwright/test";

const COOKIE_STRING = `__clerk_db_jwt=dvb_33sEKFRIqCSUFgKgd6ISV1H2mST; __clerk_db_jwt_tWz-QjHm=dvb_33sEKFRIqCSUFgKgd6ISV1H2mST; __client_uat_tWz-QjHm=1760098118; __client_uat=1760098118; _ga=GA1.1.1793903903.1782402818; spielos.org-role=owner; spielos.org=3082bc1d-94be-4c5a-bff8-83ef7e970d04; spielos.org-name=Shayan%20Tawabi's%20workspace; __next_hmr_refresh_hash__=0a3db97fcba09526a487a536db60767987ff6a740bb2c15f`;

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

function parseCookies(str: string, domain: string) {
  return str.split(";").map((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    return {
      name: name.trim(),
      value: rest.join("=").trim(),
      domain,
      path: "/",
    };
  });
}

async function audit() {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const cookies = parseCookies(COOKIE_STRING, "localhost");
  await context.addCookies(cookies);

  const page = await context.newPage();

  const errors: Record<string, string[]> = {};

  // First go to / to check if we're authenticated
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 15000 });
  const url = page.url();
  if (url.includes("/login")) {
    console.log("❌ Auth failed - still on login page. Cookies may be expired.");
    await browser.close();
    return;
  }
  console.log("✅ Authenticated! Starting audit...\n");

  for (const route of PAGES) {
    console.log(`\n🔍 ${route.name} (${route.path})`);
    const pageErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    try {
      await page.goto(`http://localhost:3000${route.path}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: `/Users/shayan/Desktop/Projects/SpielOS/tests/e2e/screenshots/${route.name.toLowerCase()}-audit.png`,
        fullPage: true,
      });

      const loadingText = await page.locator("text=/loading/i").count();
      const pulseElements = await page.locator(".animate-pulse").count();
      const spinners = await page.locator(".animate-spin").count();

      console.log(`  ✅ Loaded | 📸 Screenshot | ⏳ Loading: ${loadingText} | 💀 Skeletons: ${pulseElements} | 🔄 Spinners: ${spinners}`);

      if (pageErrors.length > 0) {
        errors[route.path] = pageErrors;
        console.log(`  ❌ Console errors: ${pageErrors.length}`);
        pageErrors.forEach((e) => console.log(`     ${e.substring(0, 200)}`));
      } else {
        console.log(`  ✅ No errors`);
      }

    } catch (err: any) {
      console.log(`  ❌ Failed: ${err.message?.substring(0, 150)}`);
    }

    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 AUDIT SUMMARY");
  console.log("=".repeat(60));
  const totalErrors = Object.values(errors).flat().length;
  console.log(`Pages: ${PAGES.length} | Errors: ${totalErrors}`);
  for (const [path, errs] of Object.entries(errors)) {
    console.log(`  ${path}: ${errs.length}`);
    errs.forEach((e) => console.log(`    ${e.substring(0, 200)}`));
  }

  await browser.close();
}

audit().catch(console.error);
