import { expect, test } from "@playwright/test";

test("loads the roundtable workspace after password sign in", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("访问密码").fill("admin");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { name: "AI Roundtable" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Light|Dark/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "退出" })).toBeVisible();
});
