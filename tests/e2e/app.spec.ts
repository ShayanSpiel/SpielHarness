import { test, expect, type Page } from "@playwright/test";

async function collectPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function expectSignInRedirect(page: Page): Promise<boolean> {
  if (!page.url().includes("/login")) return false;
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  return true;
}

const ROUTES = [
  { path: "/", name: "Home" },
  { path: "/login", name: "Login" },
  { path: "/roles", name: "Roles" },
  { path: "/skills", name: "Skills" },
  { path: "/workflows", name: "Workflows" },
  { path: "/strategy", name: "Strategy" },
  { path: "/evals", name: "Evals" },
  { path: "/settings", name: "Settings" },
];

for (const route of ROUTES) {
  test.describe(route.name, () => {
    test("loads without console or page errors", async ({ page }) => {
      const errors = await collectPageErrors(page);

      await page.goto(route.path, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);

      expect(errors, `Page errors on ${route.path}`).toEqual([]);
    });

    test("screenshot", async ({ page }) => {
      await page.goto(route.path, { waitUntil: "networkidle" });
      if (route.path !== "/login" && await expectSignInRedirect(page)) return;
      await expect(page).toHaveScreenshot(`${route.name.toLowerCase()}.png`, {
        fullPage: true,
      });
    });
  });
}

test.describe("Navigation", () => {
  test("sidebar links are visible", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    if (await expectSignInRedirect(page)) return;
    const sidebar = page.locator("nav, [role='navigation'], aside").first();
    await expect(sidebar).toBeVisible();
  });

  test("no page errors across route transitions", async ({ page }) => {
    const errors = await collectPageErrors(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    for (const route of ROUTES) {
      await page.goto(route.path, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
    }

    expect(errors, "No page errors across all route transitions").toEqual([]);
  });
});
