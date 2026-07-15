import { test, expect } from "@playwright/test";

async function expectSignInRedirect(page: import("@playwright/test").Page): Promise<boolean> {
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
    test("loads without console errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(err.message));

      await page.goto(route.path, { waitUntil: "networkidle" });

      const critical = errors.filter(
        (e) => !e.includes("favicon") && !e.includes("404"),
      );
      expect(critical, `Console errors on ${route.path}`).toEqual([]);
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
});
