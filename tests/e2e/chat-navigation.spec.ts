import { test, expect, type Page } from "@playwright/test";

async function collectPageErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test.describe("chat navigation", () => {
  test("home page loads with composer and no errors", async ({ page }) => {
    const errors = await collectPageErrors(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();

    const marker = page.locator("span[data-runtime-instance-id]");
    await expect(marker).toHaveCount(1);

    const critical = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("ResizeObserver")
    );
    expect(critical, "No errors on home page").toEqual([]);
  });

  test("composer accepts text input", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const textarea = page.locator("textarea").first();
    await textarea.fill("test message");
    await expect(textarea).toHaveValue("test message");
  });

  test("runtime instance survives route navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const marker = page.locator("span[data-runtime-instance-id]");
    await expect(marker).toHaveCount(1);
    const instanceId = await marker.getAttribute("data-runtime-instance-id");

    // Navigate away and back
    await page.goto("/skills", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Same instance
    await expect(marker).toHaveCount(1);
    const instanceIdAfter = await marker.getAttribute("data-runtime-instance-id");
    expect(instanceIdAfter).toBe(instanceId);
  });

  test("new chat welcome screen appears on fresh load", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    await expect(page.getByText("How can I help?")).toBeVisible();
    await expect(page.getByText("Message the team")).toBeVisible();
  });
});
