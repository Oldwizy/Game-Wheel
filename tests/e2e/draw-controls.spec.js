import { test, expect } from '@playwright/test';
import { seedDrawState } from '../helpers/state-fixtures.js';

test('all conflicting controls are natively disabled for an active round', async ({ page }) => {
  await seedDrawState(page, { visualMode: 'slot', durationValue: 2 });
  await page.goto('/draw.html');
  await page.locator('#startRoundBtn').click();
  for (const selector of [
    '#slotViewBtn', '#wheelViewBtn', '#battleViewBtn', '#shuffleVisualsBtn',
    '#durationRange', '#instantWinToggle', '#startRoundBtn', '#backBtn'
  ]) {
    await expect(page.locator(selector)).toBeDisabled();
  }
  await expect(page.locator('#drawTickets .step-btn').first()).toBeDisabled();
});

test('Wheel play completion does not commit until Keep or Remove', async ({ page }) => {
  await seedDrawState(page, { visualMode: 'wheel', durationValue: 2 });
  await page.goto('/draw.html');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  await page.locator('#startRoundBtn').click();
  await expect(page.locator('#wheelResultPopup')).toHaveClass(/show/);
  const provisional = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  expect(provisional.roundCount).toBe(before.roundCount);
  expect(provisional.games).toEqual(before.games);
  await page.locator('#wheelKeepBtn').click();
  const committed = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  expect(committed.roundCount).toBe(before.roundCount + 1);
});
