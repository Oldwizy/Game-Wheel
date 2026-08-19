import { test, expect } from '@playwright/test';
import { drawState, STORAGE_KEY } from '../helpers/state-fixtures.js';

test('duplicate normalized names add copies instead of cards', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('  Alpha   Game ');
  await page.locator('#copiesInput').fill('2');
  await page.locator('#addBtn').click();
  await page.locator('#gameInput').fill('alpha game');
  await page.locator('#copiesInput').fill('3');
  await page.locator('#addBtn').click();
  await expect(page.locator('#tickets .ticket')).toHaveCount(1);
  await expect(page.locator('#tickets .copies-badge')).toHaveText('× 5');
});

test('clear archives the list and history load assigns fresh IDs', async ({ page }) => {
  await page.goto('/index.html');
  for (const name of ['Alpha', 'Beta']) {
    await page.locator('#gameInput').fill(name);
    await page.locator('#addBtn').click();
  }
  await page.locator('#clearBtn').click();
  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  await page.locator('#historyList .history-item button').click();
  const ids = await page.locator('#tickets .ticket').evaluateAll(cards => cards.map(card => Number(card.dataset.id)));
  expect(ids).toEqual([3, 4]);
});

test('reset stores schema-versioned defaults', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('Alpha');
  await page.locator('#addBtn').click();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#resetAllBtn').click();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  expect(state).toMatchObject({ schemaVersion: 1, games: [], nextId: 1, visualMode: 'slot' });
});

test('reload preserves the build state', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('Persistent');
  await page.locator('#addBtn').click();
  await page.reload();
  await expect(page.locator('#tickets .tname')).toHaveText('Persistent');
});

test('starting a draw clears prior round progress and preserves configuration', async ({ page }) => {
  const seeded = drawState({
    roundCount: 4,
    logEntries: [{ text: 'Old round result', isWin: false }],
    visualMode: 'wheel',
    instantWinMode: true,
    durationValue: 15
  });

  await page.goto('/index.html');
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: seeded });
  await page.reload();
  await page.locator('#lockBtn').click();
  await expect(page).toHaveURL(/draw\.html$/);

  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved).toMatchObject({
    games: seeded.games,
    roundCount: 0,
    logEntries: [],
    visualMode: 'wheel',
    instantWinMode: true,
    durationValue: 15
  });
  await expect(page.locator('#log li')).toHaveCount(0);
});
