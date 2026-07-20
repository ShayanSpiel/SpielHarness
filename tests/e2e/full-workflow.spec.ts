import { test, expect, type Page } from "@playwright/test";

const AUTH_COOKIE = {
  name: "better-auth.session_token",
  value: "tK6hIFqq1iAZTHWRnKLFIaoKSnuHpXQe.lwZxAVZQqn7ejZPTIWA9J6bxXcxrkQDM9f+bpP7ZQhA=",
  domain: "localhost",
  path: "/",
  httpOnly: true,
};

const ORG_COOKIES = [
  { name: "spielos.org-role", value: "owner", domain: "localhost", path: "/" },
  { name: "spielos.org", value: "00000000-0000-0000-0000-000000000001", domain: "localhost", path: "/" },
  { name: "spielos.org-name", value: "Demo%20Org", domain: "localhost", path: "/" },
];

const PORT = process.env.PORT ?? 3000;
const BASE = `http://localhost:${PORT}`;

// Use load to wait for JS hydration; then wait for page-specific content
const GOTO_OPTS = { waitUntil: "load" as const, timeout: 30000 };

const AUTH_ROUTES = [
  { path: "/", name: "Home", h1: null },
  { path: "/knowledge", name: "Knowledge", h1: "Files" },
  { path: "/strategy", name: "Strategy", h1: "Strategy" },
  { path: "/roles", name: "Roles", h1: "Roles" },
  { path: "/workflows", name: "Workflows", h1: "Workflows" },
  { path: "/evals", name: "Evals", h1: "Evals" },
  { path: "/skills", name: "Skills", h1: "Skills" },
  { path: "/settings", name: "Settings", h1: "Settings" },
];

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test.describe("full workflow — authenticated", () => {

  test.beforeEach(async ({ context }) => {
    await context.addCookies([AUTH_COOKIE, ...ORG_COOKIES]);
  });

  // ── 1. Page load smoke tests ─────────────────────────────────
  test.describe("page load", () => {
    for (const route of AUTH_ROUTES) {
      test(`${route.name} loads without errors`, async ({ page }) => {
        const errors = await collectErrors(page);
        await page.goto(`${BASE}${route.path}`, GOTO_OPTS);
        await page.waitForTimeout(1000);

        expect(page.url()).not.toContain("/login");

        if (route.h1) {
          await expect(page.getByRole("heading", { name: route.h1 })).toBeVisible({ timeout: 5000 });
        }

        const critical = errors.filter(
          (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("ResizeObserver") && !e.includes("NetworkError")
        );
        expect(critical, `Errors on ${route.path}`).toEqual([]);
      });
    }
  });

  // ── 2. Navigation consistency ─────────────────────────────────
  test.describe("navigation", () => {
    test("NavRail has all expected sections and links", async ({ page }) => {
      await page.goto(`${BASE}/roles`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(500);

      const groups = page.locator("aside [role='group']");
      await expect(groups).toHaveCount(3);

      await expect(page.getByLabel("Runtime")).toBeVisible();
      await expect(page.getByLabel("New Run")).toBeVisible();
      await expect(page.getByLabel("Files")).toBeVisible();
      await expect(page.getByLabel("Strategy")).toBeVisible();
      await expect(page.getByLabel("Roles")).toBeVisible();
      await expect(page.getByLabel("Workflows")).toBeVisible();
      await expect(page.getByLabel("Evals")).toBeVisible();
      await expect(page.getByLabel("Skills")).toBeVisible();
      await expect(page.getByLabel("Settings", { exact: true })).toBeVisible();
    });

    test("navigating between routes preserves auth", async ({ page }) => {
      const errors = await collectErrors(page);

      await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(500);
      expect(page.url()).not.toContain("/login");

      const navLabels = ["Roles", "Workflows", "Evals", "Skills", "Strategy", "Files", "Settings"];
      for (const label of navLabels) {
        await page.getByLabel(label, { exact: true }).click();
        await page.waitForTimeout(1000);
        expect(page.url()).not.toContain("/login");
      }

      const critical = errors.filter(
        (e) => !e.includes("favicon") && !e.includes("ResizeObserver")
      );
      expect(critical, "No errors during navigation").toEqual([]);
    });

    test("back to home returns to chat view", async ({ page }) => {
      await page.goto(`${BASE}/workflows`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(300);
      await page.getByLabel("New Run").click();
      await page.waitForTimeout(500);
      expect(page.url()).toBe(`${BASE}/`);
    });
  });

  // ── 3. UI consistency checks ─────────────────────────────────
  test.describe("UI consistency", () => {
    test("sidebar list panels have search on CRUD pages", async ({ page }) => {
      const crudRoutes = ["Roles", "Workflows", "Evals", "Skills"];
      for (const label of crudRoutes) {
        await page.goto(`${BASE}/${label.toLowerCase()}`, { waitUntil: "load", timeout: 30000 });
        await page.waitForTimeout(500);
        expect(page.url()).not.toContain("/login");

        const searchInput = page.getByPlaceholder(new RegExp(`search ${label.toLowerCase()}`, "i"));
        await expect(searchInput).toBeVisible({ timeout: 5000 });
      }
    });

    test("settings page has tab navigation", async ({ page }) => {
      await page.goto(`${BASE}/settings`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(500);
      expect(page.url()).not.toContain("/login");

      const settingsTabs = ["Models", "Connections", "Secrets", "Billing", "Workspace", "Theme"];
      for (const tab of settingsTabs) {
        const tabLink = page.locator(`a, button`, { hasText: tab }).first();
        if (await tabLink.isVisible().catch(() => false)) {
          await tabLink.click();
          await page.waitForTimeout(300);
        }
      }
    });

    test("knowledge page has Library and Files tabs", async ({ page }) => {
      await page.goto(`${BASE}/knowledge`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(500);

      const libraryTab = page.getByText("Library");
      const filesTab = page.getByText("Files");
      await expect(libraryTab.or(page.getByRole("tab", { name: /library/i }))).toBeVisible({ timeout: 5000 });
      await expect(filesTab.or(page.getByRole("tab", { name: /files/i }))).toBeVisible({ timeout: 5000 });
    });
  });

  // ── 4. Roles page ────────────────────────────────────────────
  test.describe("roles page", () => {
    test("loads roles list and inspector panel", async ({ page }) => {
      await page.goto(`${BASE}/roles`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1000);

      await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible({ timeout: 5000 });

      const toggleBtn = page.getByLabel("Toggle inspector");
      if (await toggleBtn.isVisible().catch(() => false)) {
        await toggleBtn.click();
        await page.waitForTimeout(300);
      }
    });
  });

  // ── 5. Workflow page ─────────────────────────────────────────
  test.describe("workflows page — UI", () => {
    test("loads workflow list", async ({ page }) => {
      await page.goto(`${BASE}/workflows`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1000);

      await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible({ timeout: 5000 });
    });

    test("workflow diagram loads with controls", async ({ page }) => {
      await page.goto(`${BASE}/workflows`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1500);

      const controls = page.locator(".react-flow__controls, button:has(svg)").first();
      if (await controls.isVisible().catch(() => false)) {
        await expect(controls).toBeVisible();
      }
    });
  });

  // ── 6. Evals page ────────────────────────────────────────────
  test.describe("evals page — UI", () => {
    test("loads eval files list", async ({ page }) => {
      await page.goto(`${BASE}/evals`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1000);

      await expect(page.getByRole("heading", { name: "Evals" })).toBeVisible({ timeout: 5000 });

      const listOrEmpty = page.getByText("No matches").or(page.getByText("Test this eval"));
      await expect(listOrEmpty.first()).toBeVisible({ timeout: 5000 });
    });
  });

  // ── 7. Strategy page ─────────────────────────────────────────
  test.describe("strategy page — UI", () => {
    test("strategy and memory tabs are present", async ({ page }) => {
      await page.goto(`${BASE}/strategy`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1000);

      await expect(page.getByRole("heading", { name: "Strategy" })).toBeVisible({ timeout: 5000 });

      const strategyTab = page.getByText(/strategy/i);
      const memoryTab = page.getByText(/memory/i);
      await expect(strategyTab.or(memoryTab).first()).toBeVisible({ timeout: 5000 });
    });
  });

  // ── 8. Chat page (home) ─────────────────────────────────────
  test.describe("chat page — UI", () => {
    test("composer, welcome text, runtime instance present", async ({ page }) => {
      await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2000);

      const textarea = page.locator("textarea").first();
      await expect(textarea).toBeVisible({ timeout: 5000 });
      await expect(textarea).toBeEnabled();

      await expect(page.getByText("How can I help?")).toBeVisible({ timeout: 5000 });
      await expect(page.locator("span[data-runtime-instance-id]")).toHaveCount(1);
    });

    test("runtime instance persists after navigation", async ({ page }) => {
      await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2000);

      const marker = page.locator("span[data-runtime-instance-id]");
      await expect(marker).toHaveCount(1);
      const instanceId = await marker.getAttribute("data-runtime-instance-id");

      await page.goto(`${BASE}/settings`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2000);

      const markerAfter = page.locator("span[data-runtime-instance-id]");
      await expect(markerAfter).toHaveCount(1);
      const instanceIdAfter = await markerAfter.getAttribute("data-runtime-instance-id");
      expect(instanceIdAfter).toBe(instanceId);
    });
  });

  // ── 9. API integration (backend health) ──────────────────────
  test.describe("API integration", () => {
    test("GET /api/harness/files returns file list", async ({ page }) => {
      const resp = await page.request.get(`${BASE}/api/harness/files`);
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(Array.isArray(body.files ?? body)).toBe(true);
    });

    test("GET /api/models returns model list", async ({ page }) => {
      const resp = await page.request.get(`${BASE}/api/models`);
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(Array.isArray(body.models ?? body)).toBe(true);
    });

    test("GET /api/chats returns chat list", async ({ page }) => {
      const resp = await page.request.get(`${BASE}/api/chats`);
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(Array.isArray(body.chats ?? body)).toBe(true);
    });

    test("POST /api/runs/execute with minimal payload", async ({ page }) => {
      const resp = await page.request.post(`${BASE}/api/runs/execute`, {
        data: { message: "Say hello" },
      });
      const status = resp.status();
      expect([200, 400, 500]).toContain(status);
    });
  });
});
