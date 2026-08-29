import { test, expect } from '@playwright/test';
import {
  collectPageErrors,
  seedDrawState,
  seedTwitchState
} from '../helpers/state-fixtures.js';

function pendingRequest(overrides = {}) {
  return {
    id: 'new-game',
    rewardType: 'gameOrChance',
    rewardId: 'reward-game',
    rewardTitle: 'Додати гру або копію',
    viewerId: 'viewer-1',
    viewerName: 'Chat Hero',
    input: 'Hades II',
    redeemedAt: '2026-08-20T10:00:00.000Z',
    receivedAt: '2026-08-20T10:00:01.000Z',
    ...overrides
  };
}

async function mockLoggedInTwitch(
  page,
  rewards = [],
  redemptions = async () => ({ data: [], pagination: {} })
) {
  await page.addInitScript(() => {
    sessionStorage.setItem('twitch_token_v1', JSON.stringify({ token: 'token' }));
  });
  await page.route('https://id.twitch.tv/oauth2/validate', route => route.fulfill({
    json: {
      client_id: 'client',
      login: 'streamer',
      user_id: 'broadcaster',
      scopes: ['channel:manage:redemptions'],
      expires_in: 3600
    }
  }));
  await page.route('https://api.twitch.tv/helix/channel_points/custom_rewards?**', route => route.fulfill({
    ...(route.request().method() === 'DELETE'
      ? { status: 204, body: '' }
      : route.request().method() === 'POST'
        ? { json: { data: [{ id: 'created-reward', ...route.request().postDataJSON() }] } }
        : { json: { data: rewards } })
  }));
  await page.route(
    'https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?**',
    async route => route.fulfill({ json: await redemptions(route) })
  );
  await page.route('https://api.twitch.tv/helix/eventsub/subscriptions', route => route.fulfill({
    json: { data: [{ id: 'subscription' }] }
  }));
}

test('logged-in streamer sees two configurable reward forms', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await mockLoggedInTwitch(page);
  await page.goto('/index.html');

  const forms = page.locator('[data-reward-type]');
  await expect(forms).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Додати лот' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Додати копію лота' })).toBeVisible();
  await expect(page.getByText(
    'Новий лот додасть у список, а заявки, які вже є в списку, докине ще одну копію.'
  )).toBeVisible();
  await expect(page.getByText('Додасть ще одну копію лише лоту, який вже є у списку.')).toBeVisible();
  await expect(page.locator('#twitchGameOrChanceTitle')).toHaveValue('Додати гру або копію');
  await expect(page.locator('#twitchChanceOnlyTitle')).toHaveValue('Додати тільки копію');
  await expect(page.locator('#twitchGameOrChanceCost')).toHaveValue('100');
  await expect(page.locator('#twitchChanceOnlyCost')).toHaveValue('100');
  await expect(page.locator('#twitchGameOrChanceMax')).toHaveValue('');
  await expect(page.locator('#twitchChanceOnlyMax')).toHaveValue('');
  await expect(page.getByText('Ліміт на глядача за стрім')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Додати нагороду' })).toHaveCount(2);

  const accessibleNames = await forms.locator('input').evaluateAll(inputs => inputs.map(input => (
    input.getAttribute('aria-label')
  )));
  expect(accessibleNames.every(Boolean)).toBe(true);
  expect(new Set(accessibleNames).size).toBe(accessibleNames.length);
  expect(pageErrors).toEqual([]);
});

test('Twitch requests tab does not show reward settings', async ({ page }) => {
  await mockLoggedInTwitch(page);
  await page.goto('/index.html');

  await page.getByRole('button', { name: 'Twitch заявки' }).click();

  await expect(page.locator('[data-side-pane="rewards"]')).toBeHidden();
  await expect(page.locator('[data-side-pane="requests"]')).toBeVisible();
  await page.getByRole('tab', { name: 'Twitch заявки' }).click();
  await expect(page.locator('#twitchRequests')).toBeVisible();
});

test('streamer can create and delete a reward from the live page', async ({ page }) => {
  await mockLoggedInTwitch(page);
  await page.goto('/index.html');
  await page.locator('#twitchGameOrChanceTitle').fill('Мій скам');
  await page.locator('#twitchGameOrChanceCost').fill('250');
  await page.locator('#twitchGameOrChanceMax').fill('5');

  await page.locator('#twitchGameOrChanceAction').click();

  await expect(page.locator('#twitchGameOrChanceAction')).toHaveText('Видалити нагороду');
  await expect(page.locator('#twitchGameOrChanceTitle')).toHaveAttribute('readonly', '');
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('twitch_rewards_state_v1')).rewards.gameOrChance
  ))).toEqual({
    rewardId: 'created-reward',
    title: 'Мій скам',
    cost: 250,
    maxPerUserPerStream: 5
  });

  let confirmation = '';
  page.once('dialog', dialog => {
    confirmation = dialog.message();
    dialog.accept();
  });
  await page.locator('#twitchGameOrChanceAction').click();
  expect(confirmation).toBe('Видалити нагороду «Мій скам» з Twitch?');
  await expect(page.locator('#twitchGameOrChanceAction')).toHaveText('Додати нагороду');
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('twitch_rewards_state_v1')).rewards.gameOrChance.rewardId
  ))).toBeNull();
});

test('logging out hides Twitch requests without deleting their local data', async ({ page }) => {
  await seedTwitchState(page, {
    pending: [pendingRequest()],
    history: [pendingRequest({
      id: 'handled-request',
      handledAt: '2026-08-20T10:02:00.000Z',
      action: 'discarded',
      gameId: null,
      gameName: null
    })],
    handledRedemptionIds: ['handled-request']
  });
  await mockLoggedInTwitch(page);
  await page.goto('/index.html');

  await page.getByRole('tab', { name: 'Twitch заявки' }).click();
  await expect(page.locator('#twitchRequests')).toBeVisible();
  await page.locator('#twitchLogoutBtn').click();

  await expect(page.locator('#twitchRequests')).toBeHidden();
  const widths = await page.evaluate(() => ({
    columns: (() => {
      const workspace = document.querySelector('.workspace');
      const style = getComputedStyle(workspace);
      return workspace.getBoundingClientRect().width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    })(),
    gameList: document.querySelector('.main-board').getBoundingClientRect().width
  }));
  expect(widths.gameList).toBeCloseTo(widths.columns, 0);
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('twitch_rewards_state_v1'));
    return {
      pending: state.pending.map(request => request.id),
      history: state.history.map(request => request.id)
    };
  })).toEqual({ pending: ['new-game'], history: ['handled-request'] });
});

test('manual refresh recovers recent Twitch requests without duplicates', async ({ page }) => {
  const reward = {
    id: 'reward-game',
    title: 'Додати гру або копію',
    cost: 100,
    is_max_per_user_per_stream_enabled: false
  };
  await seedTwitchState(page, {
    rewards: {
      gameOrChance: {
        rewardId: reward.id,
        title: reward.title,
        cost: reward.cost,
        maxPerUserPerStream: null
      },
      chanceOnly: {
        rewardId: null,
        title: 'Додати тільки копію',
        cost: 100,
        maxPerUserPerStream: null
      }
    },
    pending: [pendingRequest()]
  });
  let redemptionCall = 0;
  let finishRefresh;
  const refreshResponse = new Promise(resolve => {
    finishRefresh = resolve;
  });
  await mockLoggedInTwitch(page, [reward], async () => {
    redemptionCall += 1;
    if (redemptionCall === 1) return { data: [], pagination: {} };
    return refreshResponse;
  });
  await page.goto('/index.html');
  await page.getByRole('tab', { name: 'Twitch заявки' }).click();

  const refresh = page.getByRole('button', { name: 'Оновити' });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  finishRefresh({
    data: [
      {
        id: 'new-game',
        reward: { id: reward.id, title: reward.title },
        user_id: 'viewer-1',
        user_name: 'Chat Hero',
        user_input: 'Hades II',
        redeemed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      },
      {
        id: 'recovered-game',
        reward: { id: reward.id, title: reward.title },
        user_id: 'viewer-2',
        user_name: 'Recovered Hero',
        user_input: 'Balatro',
        redeemed_at: new Date(Date.now() - 30 * 60 * 1000).toISOString()
      }
    ],
    pagination: {}
  });

  await expect(refresh).toBeEnabled();
  await expect(page.locator('#twitchPendingPanel .twitch-request-card')).toHaveCount(2);
  await expect(page.locator('#twitchRefreshStatus')).toHaveText('Заявки оновлено: нових — 1.');
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('twitch_rewards_state_v1')).pending.map(request => request.id)
  ))).toEqual(['new-game', 'recovered-game']);
});

test('Twitch request tabs show context actions and local history', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForTimeout(0);
  await page.evaluate(async () => {
    const { createTwitchRequestView } = await import('/src/build/twitch-request-view.js');
    const request = (overrides = {}) => ({
      id: 'new-game',
      rewardType: 'gameOrChance',
      rewardId: 'reward-game',
      rewardTitle: 'Додати гру або копію',
      viewerId: 'viewer-1',
      viewerName: 'Chat Hero',
      input: 'Hades II',
      redeemedAt: '2026-08-20T10:00:00.000Z',
      receivedAt: '2026-08-20T10:00:01.000Z',
      ...overrides
    });
    const state = {
      schemaVersion: 1,
      rewards: {},
      pending: [
        request(),
        request({
          id: 'extra-chance',
          rewardType: 'chanceOnly',
          rewardId: 'reward-chance',
          rewardTitle: 'Додати тільки копію',
          viewerId: 'viewer-2',
          viewerName: 'Lucky Viewer',
          input: ' alpha ',
          redeemedAt: '2026-08-20T10:01:00.000Z',
          receivedAt: '2026-08-20T10:01:01.000Z'
        })
      ],
      history: [request({
        id: 'discarded',
        viewerName: 'Old Viewer',
        input: 'Unknown Game',
        handledAt: '2026-08-20T10:02:00.000Z',
        action: 'discarded',
        gameId: null,
        gameName: null
      })],
      handledRedemptionIds: ['discarded']
    };
    window.requestCalls = [];
    window.confirm = () => true;
    window.requestView = createTwitchRequestView(document, {
      onResolve: (id, action) => window.requestCalls.push({ id, action }),
      onClearHistory: () => window.requestCalls.push({ kind: 'clear' })
    });
    window.requestView.render(state, [{ id: 1, name: 'Alpha', copies: 1 }]);
    document.getElementById('twitchPanel').hidden = false;
    document.getElementById('twitchRequestsPane').hidden = false;
    document.getElementById('twitchRequests').hidden = false;
  });

  await expect(page.locator('#twitchPendingTab')).toHaveText('Нові · 2');
  await expect(page.locator('#twitchHistoryTab')).toHaveText('Історія · 1');
  const newGame = page.locator('[data-redemption-id="new-game"]');
  const extraChance = page.locator('[data-redemption-id="extra-chance"]');
  await expect(newGame.getByRole('button', { name: 'Додати гру' })).toBeVisible();
  await expect(newGame.getByRole('button', { name: 'Копіювати' })).toHaveCount(0);
  await expect(newGame.getByRole('button', { name: 'Видалити' })).toBeVisible();
  await expect(extraChance.getByRole('button', { name: 'Додати копію' })).toBeVisible();
  await expect(extraChance.getByRole('button', { name: 'Копіювати' })).toHaveCount(0);
  await expect(extraChance.getByRole('button', { name: 'Видалити' })).toBeVisible();

  await page.locator('#twitchHistoryTab').click();
  await expect(page.locator('#twitchPendingPanel')).toBeHidden();
  const historyCard = page.locator('#twitchHistoryPanel [data-redemption-id="discarded"]');
  await expect(historyCard).toContainText('Додати гру або копію');
  await expect(historyCard).toContainText('Old Viewer');
  await expect(historyCard.locator('.twitch-request-input')).toHaveText('Unknown Game');
  await expect(historyCard).toContainText('видалено');
  await page.locator('#twitchClearHistoryBtn').click();
  expect(await page.evaluate(() => window.requestCalls)).toEqual([{ kind: 'clear' }]);
});

test('processing Twitch requests updates games, history, and persisted state', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173'
  });
  await seedDrawState(page, {
    games: [
      { id: 1, name: 'Alpha', copies: 1 },
      { id: 2, name: 'Beta', copies: 1 }
    ],
    nextId: 3
  });
  await seedTwitchState(page, {
    pending: [
      pendingRequest(),
      pendingRequest({
        id: 'extra-chance',
        rewardType: 'chanceOnly',
        rewardId: 'reward-chance',
        rewardTitle: 'Додати тільки копію',
        viewerId: 'viewer-2',
        viewerName: 'Lucky Viewer',
        input: '  aLPHa   ',
        redeemedAt: '2026-08-20T10:01:00.000Z',
        receivedAt: '2026-08-20T10:01:01.000Z'
      }),
      pendingRequest({
        id: 'missing-chance',
        rewardType: 'chanceOnly',
        rewardId: 'reward-chance',
        rewardTitle: 'Додати тільки копію',
        viewerId: 'viewer-3',
        viewerName: 'No Luck',
        input: 'Unknown Game',
        redeemedAt: '2026-08-20T10:02:00.000Z',
        receivedAt: '2026-08-20T10:02:01.000Z'
      })
    ]
  });
  await mockLoggedInTwitch(page);
  await page.goto('/index.html');
  await page.getByRole('tab', { name: 'Twitch заявки' }).click();

  const newGame = page.locator('[data-redemption-id="new-game"]');
  await expect(newGame.locator('.twitch-request-input')).toHaveText('Hades II');
  await expect(newGame.getByRole('button', { name: 'Копіювати' })).toHaveCount(0);
  await newGame.getByRole('button', { name: 'Додати гру' }).click();
  await expect(page.locator('#tickets .tname')).toContainText(['Alpha', 'Beta', 'Hades II']);
  const alpha = page.locator('#tickets .ticket').filter({ hasText: 'Alpha' });
  await page.locator('[data-redemption-id="extra-chance"]')
    .getByRole('button', { name: 'Додати копію' }).click();
  await expect(alpha.locator('.copies-badge')).toHaveText('× 2');
  const missing = page.locator('[data-redemption-id="missing-chance"]');
  await expect(missing.getByRole('button', { name: 'Додати копію' })).toHaveCount(0);
  const copyButton = missing.getByRole('button', { name: 'Копіювати' });
  await copyButton.click();
  await expect(missing.locator('.twitch-request-copy')).toHaveText('Скопійовано');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Unknown Game');
  await expect(missing.getByRole('button', { name: 'Видалити' })).toBeVisible();
  await missing.getByRole('button', { name: 'Видалити' }).click();

  await expect(page.locator('#twitchPendingTab')).toHaveText('Нові · 0');
  await expect(page.locator('#twitchHistoryTab')).toHaveText('Історія · 3');
  await page.reload();
  await expect(page.locator('#tickets .tname')).toContainText(['Alpha', 'Beta', 'Hades II']);
  await expect(page.locator('#twitchHistoryTab')).toHaveText('Історія · 3');
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('twitch_rewards_state_v1')).history.map(entry => entry.id)
  ))).toEqual(['missing-chance', 'extra-chance', 'new-game']);
});

test('processing the 51st request keeps only 50 local history cards', async ({ page }) => {
  const history = Array.from({ length: 50 }, (_, index) => ({
    ...pendingRequest({
      id: `history-${index}`,
      viewerId: `viewer-${index}`,
      viewerName: `Viewer ${index}`,
      input: `Game ${index}`
    }),
    handledAt: new Date(Date.UTC(2026, 7, 20, 12, index)).toISOString(),
    action: 'discarded',
    gameId: null,
    gameName: null
  }));
  await seedTwitchState(page, {
    pending: [pendingRequest({ id: 'request-51' })],
    history,
    handledRedemptionIds: history.map(entry => entry.id)
  });
  await mockLoggedInTwitch(page);
  await page.goto('/index.html');
  await page.getByRole('tab', { name: 'Twitch заявки' }).click();

  await page.locator('[data-redemption-id="request-51"]')
    .getByRole('button', { name: 'Видалити' }).click();
  await page.locator('#twitchHistoryTab').click();

  await expect(page.locator('#twitchHistoryPanel .twitch-request-card')).toHaveCount(50);
  expect(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('twitch_rewards_state_v1')).history.map(entry => entry.id)
  ))).toEqual(['request-51', ...history.slice(0, 49).map(entry => entry.id)]);
});
