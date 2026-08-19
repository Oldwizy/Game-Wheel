import { test, expect } from '@playwright/test';
import { collectPageErrors, seedDrawState } from '../helpers/state-fixtures.js';

test.describe('modular Slot integration', () => {
  test.beforeEach(async ({ page }) => {
    await seedDrawState(page, { visualMode: 'slot', durationValue: 2 });
    await page.goto('/draw.html');
  });

  test('Slot lands once without a post-animation transform jump', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.locator('#startRoundBtn').click();
    await expect(page.locator('#slotMachine')).toHaveClass(/slot-landed/);

    const transformAtLanding = await page.locator('#slotStrip').evaluate(element => element.style.transform);
    await page.waitForTimeout(150);
    const transformAfterWait = await page.locator('#slotStrip').evaluate(element => element.style.transform);
    const centered = page.locator('#slotStrip .slot-item-center');
    await expect(centered).toHaveCount(1);
    const selectedName = (await centered.textContent()).trim();

    expect(transformAfterWait).toBe(transformAtLanding);
    await expect(page.locator('#log')).toContainText(selectedName);
    expect(errors).toEqual([]);
  });

  test('reduced motion lands within 500 ms on the logged target', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();

    await page.locator('#startRoundBtn').click();

    await expect(page.locator('#slotMachine')).toHaveClass(/slot-landed/, { timeout: 500 });
    const centered = page.locator('#slotStrip .slot-item-center');
    await expect(centered).toHaveCount(1);
    await expect(page.locator('#log')).toContainText((await centered.textContent()).trim());
  });
});
