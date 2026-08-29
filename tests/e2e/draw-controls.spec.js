import { test, expect } from '@playwright/test';
import { seedDrawState } from '../helpers/state-fixtures.js';

test('all conflicting controls are natively disabled for an active round', async ({ page }) => {
  await seedDrawState(page, { visualMode: 'slot', durationValue: 2 });
  await page.goto('/draw.html');
  await page.locator('#startRoundBtn').click();
  for (const selector of [
    '#slotViewBtn', '#wheelViewBtn', '#mysteryViewBtn', '#shuffleVisualsBtn',
    '#durationRange', '#instantWinToggle', '#startRoundBtn', '#backBtn'
  ]) {
    await expect(page.locator(selector)).toBeDisabled();
  }
  await expect(page.locator('#drawTickets .step-btn').first()).toBeDisabled();
});

test('Wheel play completion commits automatically', async ({ page }) => {
  await seedDrawState(page, { visualMode: 'wheel', durationValue: 2 });
  await page.goto('/draw.html');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  await page.locator('#startRoundBtn').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')).roundCount)).toBe(before.roundCount + 1);
  const committed = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  expect(committed.roundCount).toBe(before.roundCount + 1);
});
