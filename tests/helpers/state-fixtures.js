export const STORAGE_KEY = 'lototron_state_v1';
export const TWITCH_STATE_KEY = 'twitch_rewards_state_v1';

export function drawState(overrides = {}) {
  return {
    games: [
      { id: 1, name: 'Alpha', copies: 1 },
      { id: 2, name: 'Beta', copies: 2 },
      { id: 3, name: 'Gamma', copies: 1 }
    ],
    nextId: 4,
    roundCount: 0,
    logEntries: [],
    visualMode: 'slot',
    instantWinMode: false,
    durationValue: 2,
    ...overrides
  };
}

export async function seedDrawState(page, overrides = {}) {
  const state = drawState(overrides);
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: state });
  return state;
}

export function twitchState(overrides = {}) {
  return {
    schemaVersion: 1,
    rewards: {
      gameOrChance: {
        rewardId: null,
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
    },
    pending: [],
    history: [],
    handledRedemptionIds: [],
    ...overrides
  };
}

export async function seedTwitchState(page, overrides = {}) {
  const state = twitchState(overrides);
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: TWITCH_STATE_KEY, value: state });
  return state;
}

export function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}
