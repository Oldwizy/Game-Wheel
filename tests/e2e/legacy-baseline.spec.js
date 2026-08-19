import { test, expect } from '@playwright/test';
import { collectPageErrors, seedDrawState } from '../helpers/state-fixtures.js';

test('build page creates two games and unlocks draw navigation', async ({ page }) => {
  const failedResponses = [];
  page.on('response', response => { if (response.status() >= 400) failedResponses.push([response.status(), response.url()]); });
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('Alpha');
  await page.locator('#addBtn').click();
  await page.locator('#gameInput').fill('Beta');
  await page.locator('#addBtn').click();
  await expect(page.locator('#tickets .ticket')).toHaveCount(2);
  await expect(page.locator('#lockBtn')).toBeEnabled();
  expect(await page.locator('script[type="module"]').count()).toBe(1);
  expect(failedResponses).toEqual([]);
});

test('draw page loads saved copies, all modes, and no runtime errors', async ({ page }) => {
  await seedDrawState(page);
  const errors = collectPageErrors(page);
  const failedResponses = [];
  page.on('response', response => { if (response.status() >= 400) failedResponses.push([response.status(), response.url()]); });
  await page.goto('/draw.html');
  await expect(page.locator('#drawTickets .ticket')).toHaveCount(3);
  await expect(page.locator('#slotViewBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#wheelViewBtn').click();
  await expect(page.locator('#wheelMachine')).toBeVisible();
  await page.locator('#battleViewBtn').click();
  await expect(page.locator('#battleMachine')).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.locator('script[type="module"]').count()).toBe(1);
  expect(failedResponses).toEqual([]);
});
