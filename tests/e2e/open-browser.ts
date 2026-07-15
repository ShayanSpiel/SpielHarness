import { chromium } from "@playwright/test";

async function open() {
  const browser = await chromium.launch({ 
    headless: false,
    channel: "chrome",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  console.log("Real Chrome open. Log in. Tell me when ready.");
  
  await new Promise(() => {});
}

open();
