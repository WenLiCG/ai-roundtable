import { expect, test } from "@playwright/test";

test("loads the roundtable workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI Roundtable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始" })).toBeVisible();
  await expect(page.getByRole("button", { name: "模型" })).toBeVisible();
});

