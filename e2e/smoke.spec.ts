import { test, expect } from "@playwright/test";

test.describe("App Smoke Spec", () => {
  test("smoke boot and auth endpoint responds with brand assets", async ({ page }) => {
    const response = await page.goto("/auth");
    expect(response?.status()).toBeLessThan(400);

    // Verify core branding and elements are rendered
    await expect(page.locator("text=RTA / RTS Management Console").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
