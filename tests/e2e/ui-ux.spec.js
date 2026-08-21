import { test, expect } from '@playwright/test';
import { seedDrawState } from '../helpers/state-fixtures.js';

test('logged-out Twitch tools stay compact until the user expands them', async ({ page }) => {
  await page.goto('/index.html');

  const panel = page.locator('#twitchPanel');
  await expect(panel).toHaveCount(1);
  await expect(panel).not.toHaveAttribute('open', '');
  await expect(page.locator('.twitch-hint')).toBeHidden();

  await panel.locator('summary').click();
  await expect(page.locator('.twitch-hint')).toBeVisible();
});

test('build page explains how many variants are still needed', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#startHint')).toHaveText('Додай щонайменше 2 варіанти');

  await page.locator('#gameInput').fill('Alpha');
  await page.locator('#addBtn').click();
  await expect(page.locator('#startHint')).toHaveText('Додай ще 1 варіант');

  await page.locator('#gameInput').fill('Beta');
  await page.locator('#addBtn').click();
  await expect(page.locator('#startHint')).toHaveText('Усе готово до скаму');
});

test('adding a new or duplicate variant confirms what changed', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('Alpha');
  await page.locator('#addBtn').click();
  await expect(page.locator('#buildStatus')).toHaveText('«Alpha» додано.');

  await page.locator('#gameInput').fill('alpha');
  await page.locator('#copiesInput').fill('3');
  await page.locator('#addBtn').click();
  await expect(page.locator('#buildStatus')).toHaveText('Для «Alpha» додано ще 3 копії.');
});

test('mobile draw settings appear before the visualization and participant details start collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedDrawState(page);
  await page.goto('/draw.html');

  const sidePanel = await page.locator('#drawSidePanel').boundingBox();
  const drawPanel = await page.locator('#drawPanel').boundingBox();
  const drawer = page.locator('#participantsDrawer');

  expect(sidePanel).not.toBeNull();
  expect(drawPanel).not.toBeNull();
  expect(sidePanel.y).toBeLessThan(drawPanel.y);
  await expect(drawer).not.toHaveAttribute('open', '');
  await expect(drawer.locator('summary')).toBeVisible();
});

test('mobile build controls stay compact instead of inheriting desktop flex height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');

  const inputShell = await page.locator('.input-shell').boundingBox();

  expect(inputShell).not.toBeNull();
  expect(inputShell.height).toBeLessThanOrEqual(64);
});

test('mobile start action does not cover the empty-state instructions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');

  const emptyState = await page.locator('#emptyNote').boundingBox();
  const startAction = await page.locator('.cta-bar').boundingBox();

  expect(emptyState).not.toBeNull();
  expect(startAction).not.toBeNull();
  expect(startAction.y).toBeGreaterThanOrEqual(emptyState.y + emptyState.height);
});

test('icon fallbacks never expose Material Symbol ligature names', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto('/index.html');

  const leakedLigatures = await page.locator('.msi').evaluateAll(nodes => nodes
    .map(node => node.textContent.trim())
    .filter(text => /[A-Za-z_]/.test(text)));

  expect(leakedLigatures).toEqual([]);
});

test('keyboard users get a visible focus indicator and descriptive field names', async ({ page }) => {
  await page.goto('/index.html');
  await page.keyboard.press('Tab');
  await expect(page.locator('#twitchPanel summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.locator('#twitchLoginBtn')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#gameInput')).toBeFocused();

  const focus = await page.locator('#gameInput').evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });

  expect(focus.style).not.toBe('none');
  expect(focus.width).not.toBe('0px');
  await expect(page.locator('#copiesInput')).toHaveAccessibleName('Кількість копій');
});

test('game card controls describe their action and target', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('Alpha');
  await page.locator('#copiesInput').fill('2');
  await page.locator('#addBtn').click();

  const card = page.locator('#tickets .ticket');
  await expect(card.locator('.minus-btn')).toHaveAccessibleName('Зменшити кількість копій Alpha');
  await expect(card.locator('.plus-btn')).toHaveAccessibleName('Збільшити кількість копій Alpha');
  await expect(card.locator('.del-btn')).toHaveAccessibleName('Видалити Alpha');
});

test('draw participant controls describe their action and target', async ({ page }) => {
  await seedDrawState(page);
  await page.goto('/draw.html');

  const alpha = page.locator('#drawTickets .ticket').filter({ hasText: 'Alpha' });
  await expect(alpha.locator('.minus-btn')).toHaveAccessibleName('Зменшити кількість копій Alpha');
  await expect(alpha.locator('.plus-btn')).toHaveAccessibleName('Збільшити кількість копій Alpha');
});
