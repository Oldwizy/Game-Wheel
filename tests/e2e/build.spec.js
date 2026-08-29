import { test, expect } from '@playwright/test';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/state.js';
import {
  drawState,
  seedDrawState,
  seedTwitchState,
  STORAGE_KEY
} from '../helpers/state-fixtures.js';

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

test('clear-list action is not offered', async ({ page }) => {
  await page.goto('/index.html');

  await expect(page.getByRole('button', { name: 'ОЧИСТИТИ СПИСОК' })).toHaveCount(0);
});

test('reset archives the list so it can be copied and pasted again', async ({ page }) => {
  await page.goto('/index.html');
  for (const name of ['Alpha', 'Beta']) {
    await page.locator('#gameInput').fill(name);
    await page.locator('#addBtn').click();
  }
  let confirmation = '';
  page.once('dialog', dialog => {
    confirmation = dialog.message();
    dialog.accept();
  });
  await page.locator('#resetAllBtn').click();
  await page.getByRole('link', { name: 'Історія' }).click();
  expect(confirmation).toBe('Скинути все й почати заново? Буде очищено список, налаштування та прогрес.');
  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  await expect(page.locator('#historyList .h-date')).toContainText('2 гри');
  await page.locator('#historyList .history-item button').click();
  await expect(page.getByRole('button', { name: 'Вставити список' })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Вставити список' }).click();
  await expect(page.getByRole('button', { name: 'Додати до пулу' })).toBeVisible();

  await page.getByRole('link', { name: 'Історія' }).click();
  await page.locator('#historyList .history-item button').click();
  let pasteConfirmation = '';
  page.once('dialog', dialog => {
    pasteConfirmation = dialog.message();
    dialog.accept();
  });
  await page.getByRole('button', { name: 'Вставити список' }).click();
  expect(pasteConfirmation).toBe('Вставити скопійований список? Усі поточні записи буде стерто.');
  await expect(page.locator('#tickets .tname')).toHaveText(['Alpha', 'Beta']);
  await expect(page.getByRole('button', { name: 'Додати до пулу' })).toBeVisible();
});

test('reset stores schema-versioned defaults', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('Alpha');
  await page.locator('#addBtn').click();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#resetAllBtn').click();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  expect(state).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, games: [], nextId: 1, visualMode: 'slot' });
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

test('starting a draw closes Twitch listening before navigation', async ({ page }) => {
  await seedDrawState(page);
  await seedTwitchState(page, {
    rewards: {
      gameOrChance: {
        rewardId: 'reward-game',
        title: 'Додати гру або копію',
        cost: 100,
        maxPerUserPerStream: null
      },
      chanceOnly: {
        rewardId: null,
        title: 'Додати тільки копію',
        cost: 100,
        maxPerUserPerStream: null
      }
    }
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('twitch_token_v1')) {
      sessionStorage.setItem('twitch_token_v1', JSON.stringify({ token: 'token' }));
    }
    window.__socketCount = 0;
    window.WebSocket = class {
      constructor() {
        window.__socketCount += 1;
      }
      close() {
        sessionStorage.setItem('twitchClosedCount', String(
          Number(sessionStorage.getItem('twitchClosedCount') ?? 0) + 1
        ));
        sessionStorage.setItem('twitchClosedPath', location.pathname);
      }
    };
  });
  await page.route('https://id.twitch.tv/oauth2/validate', route => route.fulfill({
    json: { login: 'streamer', user_id: 'broadcaster' }
  }));
  const deletedRewardIds = [];
  await page.route('https://api.twitch.tv/helix/channel_points/custom_rewards?**', route => {
    if (route.request().method() === 'DELETE') {
      deletedRewardIds.push(new URL(route.request().url()).searchParams.get('id'));
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      json: { data: [{ id: 'reward-game', title: 'Додати гру або копію' }] }
    });
  });
  await page.route('https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?**', route => route.fulfill({
    json: { data: [], pagination: {} }
  }));
  await page.goto('/index.html');
  await expect.poll(() => page.evaluate(() => window.__socketCount)).toBe(1);

  await page.locator('#lockBtn').click();
  await expect(page).toHaveURL(/draw\.html$/);

  expect(await page.evaluate(() => ({
    count: Number(sessionStorage.getItem('twitchClosedCount')),
    path: sessionStorage.getItem('twitchClosedPath')
  }))).toEqual({ count: 1, path: '/index.html' });
  expect(deletedRewardIds).toEqual(['reward-game']);
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('twitch_rewards_state_v1')).rewards.gameOrChance.rewardId
  ))).toBeNull();
});

test('starting a draw warns but continues when Twitch cannot delete a reward', async ({ page }) => {
  await seedDrawState(page);
  await seedTwitchState(page, {
    rewards: {
      gameOrChance: {
        rewardId: 'reward-game',
        title: 'Мій скам',
        cost: 100,
        maxPerUserPerStream: null
      },
      chanceOnly: {
        rewardId: null,
        title: 'Додати тільки копію',
        cost: 100,
        maxPerUserPerStream: null
      }
    }
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('twitch_token_v1', JSON.stringify({ token: 'token' }));
    window.WebSocket = class { close() {} };
  });
  await page.route('https://id.twitch.tv/oauth2/validate', route => route.fulfill({
    json: { login: 'streamer', user_id: 'broadcaster' }
  }));
  await page.route('https://api.twitch.tv/helix/channel_points/custom_rewards?**', route => (
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 503, json: { message: 'Twitch приліг' } })
      : route.fulfill({ json: { data: [{ id: 'reward-game', title: 'Мій скам' }] } })
  ));
  await page.route('https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?**', route => (
    route.fulfill({ json: { data: [], pagination: {} } })
  ));
  let warning = '';
  page.on('dialog', async dialog => {
    warning = dialog.message();
    await dialog.accept();
  });
  await page.goto('/index.html');
  await expect(page.locator('#twitchHeaderName')).toHaveText('@streamer');

  await page.locator('#lockBtn').click();

  await expect(page).toHaveURL(/draw\.html$/);
  expect(warning).toBe('Не вдалося видалити з Twitch: Мій скам. Перевір нагороди вручну.');
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('twitch_rewards_state_v1')).rewards.gameOrChance.rewardId
  ))).toBe('reward-game');
});
