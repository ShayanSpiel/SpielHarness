import { chromium } from "@playwright/test";

const ALL_COOKIES = [
  { name: "__session", value: "eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zM3NEdFFzckVza3hFdUZ1cmVyNTlYdmN1dG0iLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJleHAiOjE3NjAwOTgzMDYsImZ2YSI6WzIsLTFdLCJpYXQiOjE3NjAwOTgyNDYsImlzcyI6Imh0dHBzOi8vc3VwcmVtZS1ib2FyLTQyLmNsZXJrLmFjY291bnRzLmRldiIsIm5iZiI6MTc2MDA5ODIzNiwic2lkIjoic2Vzc18zM3NGeE9CR3V0d0FkRjZ1WldPbFJnOHhuNm8iLCJzdHMiOiJhY3RpdmUiLCJzdWIiOiJ1c2VyXzMzc0Z4UHAzOVFsZmI3clFvWGFOdDFlcGlqYiIsInYiOjJ9.j434irmkEGsHlLH4XYtxqF9Mp4kO1oY_ZoJ1JBfbeMEkOPERi9g8DN50TVw3uBZDxaBlSjW1AiVqyuc8KNODgxvF4pRyuLPjMiOsJo7YPH4pyKyOchB4eftNGpHG1OHENtWDYMb78NOR0unejuW1hB8Q6O_hmJomWWEqOldTKJMtf4nWq7x_Vr_OkqAS6WtZ4c9eADs_atAh_ZOKECat86bl5iEgGb0Fz7w6eBg8vNqOf4FDE-kmuf2BK6yxyuXc5iIBOrR-mipZ_FewMPOsDoMRTqadYR1K7sG1S29yfOKV15wo-TaYeVtzDcKVmhoWLyXrppmyYCtqHO8655p6Tg", domain: "localhost", path: "/" },
  { name: "__session_tWz-QjHm", value: "eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zM3NEdFFzckVza3hFdUZ1cmVyNTlYdmN1dG0iLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAiLCJleHAiOjE3NjAwOTgzMDYsImZ2YSI6WzIsLTFdLCJpYXQiOjE3NjAwOTgyNDYsImlzcyI6Imh0dHBzOi8vc3VwcmVtZS1ib2FyLTQyLmNsZXJrLmFjY291bnRzLmRldiIsIm5iZiI6MTc2MDA5ODIzNiwic2lkIjoic2Vzc18zM3NGeE9CR3V0d0FkRjZ1WldPbFJnOHhuNm8iLCJzdHMiOiJhY3RpdmUiLCJzdWIiOiJ1c2VyXzMzc0Z4UHAzOVFsZmI3clFvWGFOdDFlcGlqYiIsInYiOjJ9.j434irmkEGsHlLH4XYtxqF9Mp4kO1oY_ZoJ1JBfbeMEkOPERi9g8DN50TVw3uBZDxaBlSjW1AiVqyuc8KNODgxvF4pRyuLPjMiOsJo7YPH4pyKyOchB4eftNGpHG1OHENtWDYMb78NOR0unejuW1hB8Q6O_hmJomWWEqOldTKJMtf4nWq7x_Vr_OkqAS6WtZ4c9eADs_atAh_ZOKECat86bl5iEgGb0Fz7w6eBg8vNqOf4FDE-kmuf2BK6yxyuXc5iIBOrR-mipZ_FewMPOsDoMRTqadYR1K7sG1S29yfOKV15wo-TaYeVtzDcKVmhoWLyXrppmyYCtqHO8655p6Tg", domain: "localhost", path: "/" },
  { name: "__clerk_db_jwt", value: "dvb_33sEKFRIqCSUFgKgd6ISV1H2mST", domain: "localhost", path: "/" },
  { name: "__clerk_db_jwt_tWz-QjHm", value: "dvb_33sEKFRIqCSUFgKgd6ISV1H2mST", domain: "localhost", path: "/" },
  { name: "__client_uat", value: "1760098118", domain: "localhost", path: "/" },
  { name: "__client_uat_tWz-QjHm", value: "1760098118", domain: "localhost", path: "/" },
  { name: "spielos.org-role", value: "owner", domain: "localhost", path: "/" },
  { name: "spielos.org", value: "3082bc1d-94be-4c5a-bff8-83ef7e970d04", domain: "localhost", path: "/" },
  { name: "spielos.org-name", value: "Shayan%20Tawabi's%20workspace", domain: "localhost", path: "/" },
  { name: "sb-ztjqapbnhnkgotqmpypk-auth-token", value: "base64-eyJhY2Nlc3NfdG9rZW4iOiJleUpoYkdjaU9pSklVekkxTmlJc0ltdHBaQ0k2SW1oSGEzRk1VeTloWjFWT1VHcDBVMmNpTENKMGVYQWlPaUpLVjFRaWZRLmV5SnBjM01pT2lKb2RIUndjem92TDNwMGFuRmhjR0p1YUc1cloyOTBjVzF3ZVhCckxuTjFjR0ZpWVhObExtTnZMMkYxZEdndmRqRWlMQ0p6ZFdJaU9pSXlaRGMyWmpFNU5TMWpOR1JqTFRSbVpEZ3RPRGczWlMxaE56TTNaakkyWldOak1EQWlMQ0poZFdRaU9pSmhkWFJvWlc1MGFXTmhkR1ZrSWl3aVpYaHdJam94TnpneU56WTRPRFl5TENKcFlYUWlPakUzT0RJM05qVXlOaklzSW1WdFlXbHNJam9pTmpaemFHRjVZVzVBWjIxaGFXd3VZMjl0SWl3aWNHaHZibVVpT2lJaUxDSmhjSEJmYldWMFlXUmhkR0VpT25zaWNISnZkbWxrWlhJaU9pSmxiV0ZwYkNJc0luQnliM1pwWkdWeWN5STZXeUpsYldGcGJDSmRmU3dpZFhObGNsOXRaWFJoWkdGMFlTSTZleUpsYldGcGJDSTZJalkyYzJoaGVXRnVRR2R0WVdsc0xtTnZiU0lzSW1WdFlXbHNYM1psY21sbWFXVmtJanAwY25WbExDSndhRzl1WlY5MlpYSnBabWxsWkNJNlptRnNjMlVzSW5OMVlpSTZJakprTnpabU1UazFMV00wWkdNdE5HWmtPQzA0T0RkbExXRTNNemRtTWpabFkyTXdNQ0lzSW5WelpYSnVZVzFsSWpvaVUyaGhlV0Z1SW4wc0luSnZiR1VpT2lKaGRYUm9aVzUwYVdOaGRHVmtJaXdpWVdGc0lqb2lZV0ZzTVNJc0ltRnRjaUk2VzNzaWJXVjBhRzlrSWpvaWNHRnpjM2R2Y21RaUxDSjBhVzFsYzNSaGJYQWlPakUzT0RBNU16WTJNRGw5WFN3aWMyVnpjMmx2Ymw5cFpDSTZJbUZoWVRBNVlXUTBMVEU1Wm1RdE5HSTRNaTFoTVdFM0xUa3lZMkk0WldKaFlXVTFZU0lzSW1selgyRnViMjU1Ylc5MWN5STZabUZzYzJWOS5iUWlQa2RibVBxTWk0MWdTWUt0QlcwQTJTcTVtTzk2OW9Pd0F0TjdhSTdrIiwidG9rZW5fdHlwZSI6ImJlYXJlciIsImV4cGlyZXNfaW4iOjM2MDAsImV4cGlyZXNfYXQiOjE3ODI3Njg4NjIsInJlZnJlc2hfdG9rZW4iOiJodGR3Z3hjZHdnb2MiLCJ1c2VyIjp7ImlkIjoiMmQ3NmYxOTUtYzRkYy00ZmQ4LTg4N2UtYTczN2YyNmVjYzAwIiwiYXVkIjoiYXV0aGVudGljYXRlZCIsInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiZW1haWwiOiI2NnNoYXlhbkBnbWFpbC5jb20iLCJlbWFpbF9jb25maXJtZWRfYXQiOiIyMDI1LTEyLTEwVDAxOjI4OjI5LjAwNjkwMloiLCJwaG9uZSI6IiIsImNvbmZpcm1lZF9hdCI6IjIwMjUtMTItMTBUMDE6Mjg6MjkuMDA2OTAyWiIsImxhc3Rfc2lnbl9pbl9hdCI6IjIwMjYtMDYtMDhUMTY6Mzg6NDQuOTU5MzEyWiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoiNjZzaGF5YW5AZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiMmQ3NmYxOTUtYzRkYy00ZmQ4LTg4N2UtYTczN2YyNmVjYzAwIiwidXNlcm5hbWUiOiJTaGF5YW4ifSwiaWRlbnRpdGllcyI6W3siaWRlbnRpdHlfaWQiOiJmMDVlMmJhOC1lMzRmLTRmODMtYjdmYS03MWQ5NzdlNmI2YTIiLCJpZCI6IjJkNzZmMTk1LWM0ZGMtNGZkOC04ODdlLWE3MzdmMjZlY2MwMCIsInVzZXJfaWQiOiIyZDc2ZjE5NS1jNGRjLTRmZDgtODg3ZS1hNzM3ZjI2ZWNjMDAiLCJpZGVudGl0eV9kYXRhIjp7ImVtYWlsIjoiNjZzaGF5YW5AZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiMmQ3NmYxOTUtYzRkYy00ZmQ4LTg4N2UtYTczN2YyNmVjYzAwIiwidXNlcm5hbWUiOiJTaGF5YW4ifSwicHJvdmlkZXIiOiJlbWFpbCIsImxhc3Rfc2lnbl9pbl9hdCI6IjIwMjUtMTItMTBUMDE6Mjc6NTkuNTU1MTUxWiIsImNyZWF0ZWRfYXQiOiIyMDI1LTEyLTEwVDAxOjI3OjU5LjU1NTE5OFoiLCJ1cGRhdGVkX2F0IjoiMjAyNS0xMi0xMFQwMToyNzo1OS41NTUxOThaIiwiZW1haWwiOiI2NnNoYXlhbkBnbWFpbC5jb20ifV0sImNyZWF0ZWRfYXQiOiIyMDI1LTEyLTEwVDAxOjI3OjU5LjQ5NTg2WiIsInVwZGF0ZWRfYXQiOiIyMDI2LTA2LTI2VDE1OjQ2OjIwLjMyNjk1NFoiLCJpc19hbm9ueW1vdXMiOmZhbHNlfX0", domain: "localhost", path: "/" },
];

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
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  await context.addCookies(ALL_COOKIES);

  const page = await context.newPage();

  const errors: Record<string, string[]> = {};

  await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 15000 });
  const url = page.url();
  if (url.includes("/login")) {
    console.log("❌ Auth failed - still on login.");
    await browser.close();
    return;
  }
  console.log("✅ Authenticated!\n");

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

      console.log(`  ✅ Loaded | ⏳ Loading: ${loadingText} | 💀 Skeletons: ${pulseElements} | 🔄 Spinners: ${spinners}`);

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
