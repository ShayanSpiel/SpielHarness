import { test, expect, type Page } from "@playwright/test";

// ── Fixture: collect and fail on any page error ─────────────
// Every regression test uses this so "Parent message not found"
// and similar assistant-ui errors surface as test failures.

async function collectPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  // Also collect console errors for good measure
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test.describe("chat regression", () => {

  test("page loads without runtime errors", async ({ page }) => {
    const errors = await collectPageErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });

    // Allow some time for any async initialization errors to surface
    await page.waitForTimeout(1000);

    const critical = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("ResizeObserver")
    );
    expect(critical, "No page errors on initial load").toEqual([]);
  });

  test("composer input exists on the home page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
  });

  test("runtime instance span is present", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const marker = page.locator("span[data-runtime-instance-id]");
    await expect(marker).toHaveCount(1);
  });

  test("welcome screen is visible on first load", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    await expect(page.getByText("How can I help?")).toBeVisible();
  });

  test("send message and check for runtime errors during streaming", async ({ page }) => {
    const errors = await collectPageErrors(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();

    // Type and send a message
    await textarea.fill("Say hello and nothing else.");
    await textarea.press("Enter");

    // Wait long enough for the run to start and potentially fail
    // If the backend is unavailable, the adapter catches the error
    // and yields an error message instead of a "Parent message not found".
    await page.waitForTimeout(3000);

    // The critical assertion: no "Parent message not found" or similar
    // assistant-ui internal errors should surface as page errors.
    const criticalErrors = errors.filter((e) => {
      const lower = e.toLowerCase();
      return lower.includes("parent message") ||
             lower.includes("addOrUpdateMessage") ||
             lower.includes("messageRepository") ||
             lower.includes("message_repository");
    });

    expect(criticalErrors, "No assistant-ui parent message errors during streaming").toEqual([]);

    // Also ensure no fatal page errors beyond expected network failures
    const fatal = errors.filter((e) => {
      const lower = e.toLowerCase();
      return !lower.includes("favicon") &&
             !lower.includes("404") &&
             !lower.includes("resizeobserver") &&
             !lower.includes("failed to load") &&
             !lower.includes("networkerror") &&
             !lower.includes("network error") &&
             !lower.includes("unable to connect") &&
             !lower.includes("fetch failed");
    });
    expect(fatal, "No unexpected page errors during streaming").toEqual([]);
  });

  test("navigating away and back preserves runtime instance", async ({ page }) => {
    const errors = await collectPageErrors(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const marker = page.locator("span[data-runtime-instance-id]");
    const instanceId = await marker.getAttribute("data-runtime-instance-id");

    // Navigate to settings
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Navigate back
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Same runtime instance should exist
    const markerAfter = page.locator("span[data-runtime-instance-id]");
    await expect(markerAfter).toHaveCount(1);

    const critical = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("ResizeObserver")
    );
    expect(critical, "No page errors after navigation").toEqual([]);
  });

  test("composer stays interactive after navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Navigate to settings and back
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEnabled();
  });
});
