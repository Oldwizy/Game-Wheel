import { test, expect } from '@playwright/test';
import { collectPageErrors, seedDrawState } from '../helpers/state-fixtures.js';

test('logged-out home does not render an empty Twitch panel', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#twitchPanel')).toBeHidden();
});

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

test('only the lot cards scroll when the pool exceeds the available height', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/index.html');
  for (let index = 1; index <= 18; index += 1) {
    await page.locator('#gameInput').fill(`Лот ${index}`);
    await page.locator('#addBtn').click();
  }

  const dimensions = await page.locator('#tickets').evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth
  }));

  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.overflowY).toBe('auto');
  expect(dimensions.scrollbarWidth).toBe('none');
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
