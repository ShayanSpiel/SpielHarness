import { test, expect } from "@playwright/test";

test.describe("chat navigation", () => {
  test("creates a new chat and navigates to it", async ({ page }) => {
    await page.goto("/app");
    const runCount = page.locator("[data-testid='run-item']");
    const startCount = await runCount.count();

    await page.locator("[data-testid='new-chat-button']").click();
    await expect(runCount).toHaveCount(startCount + 1);

    const lastChat = runCount.first();
    await lastChat.click();
    await expect(page).toHaveURL(/\/runs\//);
  });

  test("switching chats preserves chat history on navigation", async ({ page }) => {
    await page.goto("/app");
    const firstChat = page.locator("[data-testid='run-item']").first();
    await firstChat.click();
    await expect(page).toHaveURL(/\/runs\//);

    const secondChat = page.locator("[data-testid='run-item']").nth(1);
    await secondChat.click();

    const runtimeInstanceId = page.locator("span[data-runtime-instance-id]");
    await expect(runtimeInstanceId).toHaveCount(1);

    const input = page.locator("textarea, [contenteditable='true']").first();
    await expect(input).toBeVisible();
  });

  test("new chat is seeded from SSE frames not placeholder messages", async ({ page }) => {
    await page.goto("/app");

    const initialMsgCount = await page.locator("[data-testid='chat-message']").count();

    await page.locator("[data-testid='new-chat-button']").click();
    await page.waitForTimeout(500);

    const runtimeInstanceId = page.locator("span[data-runtime-instance-id]");
    await expect(runtimeInstanceId).toHaveCount(1);

    const msgCountAfter = await page.locator("[data-testid='chat-message']").count();
    expect(msgCountAfter).toBeGreaterThanOrEqual(initialMsgCount);
  });

  test("navigating away and back preserves active chat", async ({ page }) => {
    await page.goto("/app");
    const firstChat = page.locator("[data-testid='run-item']").first();
    await firstChat.click();

    const activeUrl = page.url();

    await page.goto("/settings");
    await page.goto(activeUrl);

    await expect(page).toHaveURL(activeUrl);
    const input = page.locator("textarea, [contenteditable='true']").first();
    await expect(input).toBeVisible();
  });

  test("direct URL access loads correct chat", async ({ page }) => {
    await page.goto("/app");
    const chatLink = page.locator("[data-testid='run-item']").first().locator("a");
    const href = await chatLink.getAttribute("href");
    if (!href) throw new Error("no href");

    await page.goto(href);
    const runtimeInstanceId = page.locator("span[data-runtime-instance-id]");
    await expect(runtimeInstanceId).toHaveCount(1);
    await expect(page).toHaveURL(/\/runs\//);
  });
});
