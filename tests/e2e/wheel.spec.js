import { expect, test } from '@playwright/test';
import { collectPageErrors, seedDrawState } from '../helpers/state-fixtures.js';

test.describe('modular Wheel integration', () => {
  test.beforeEach(async ({ page }) => {
    await seedDrawState(page, { visualMode: 'wheel', durationValue: 2 });
    await page.goto('/draw.html');
  });

  test('round removes the landed sector without showing a decision popup', async ({ page }) => {
    const errors = collectPageErrors(page);
    const labelsBefore = await page.locator('#wheelSvg .wheel-label').allTextContents();

    await page.locator('#startRoundBtn').click();

    await expect.poll(async () => (await page.locator('#wheelSvg .wheel-label').count())).toBe(labelsBefore.length - 1);
    await expect(page.locator('#wheelResultPopup')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('reduced motion commits within 500 ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const labelsBefore = await page.locator('#wheelSvg .wheel-label').count();

    await page.locator('#startRoundBtn').click();

    await expect.poll(async () => (await page.locator('#wheelSvg .wheel-label').count()), { timeout: 500 }).toBe(labelsBefore - 1);
  });
});
