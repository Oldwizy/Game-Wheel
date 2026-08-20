export const STORAGE_KEY = 'lototron_state_v1';

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
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: state });
  return state;
}

export function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}
