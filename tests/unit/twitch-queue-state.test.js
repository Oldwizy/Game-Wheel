import { describe, expect, test } from 'vitest';
import {
  REWARD_TYPES,
  TWITCH_STATE_KEY,
  clearRequestHistory,
  createDefaultTwitchState,
  loadTwitchState,
  mergePending,
  reconcileHandledIds,
  resolvePending,
  saveTwitchState
} from '../../src/integrations/twitch-queue-state.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function redemption(id, redeemedAt, overrides = {}) {
  return {
    id,
    rewardType: REWARD_TYPES.GAME_OR_CHANCE,
    rewardId: 'reward-game',
    rewardTitle: 'Додати гру або копію',
    viewerId: 'viewer-id',
    viewerName: 'Viewer',
    input: 'Hades II',
    redeemedAt,
    receivedAt: '2026-08-20T19:00:00.000Z',
    ...overrides
  };
}

describe('Twitch queue state persistence', () => {
  test('defaults define two configurable reward slots', () => {
    expect(createDefaultTwitchState()).toEqual({
      schemaVersion: 1,
      rewards: {
        gameOrChance: {
          rewardId: null,
          title: 'Додати гру або копію',
          cost: 100,
          maxPerStream: null
        },
        chanceOnly: {
          rewardId: null,
          title: 'Додати тільки копію',
          cost: 100,
          maxPerStream: null
        }
      },
      pending: [],
      history: [],
      handledRedemptionIds: []
    });
    expect(REWARD_TYPES).toEqual({
      GAME_OR_CHANCE: 'gameOrChance',
      CHANCE_ONLY: 'chanceOnly'
    });
  });

  test('migrates legacy default titles only for rewards not yet created', () => {
    const legacy = createDefaultTwitchState();
    legacy.rewards.gameOrChance.title = 'Додати гру або шанс';
    legacy.rewards.chanceOnly = {
      ...legacy.rewards.chanceOnly,
      rewardId: 'created-reward',
      title: 'Додати тільки шанс'
    };

    const result = loadTwitchState(storage({
      [TWITCH_STATE_KEY]: JSON.stringify(legacy)
    }));

    expect(result.error).toBeNull();
    expect(result.value.rewards.gameOrChance.title).toBe('Додати гру або копію');
    expect(result.value.rewards.chanceOnly.title).toBe('Додати тільки шанс');
  });

  test('valid state survives a storage round trip', () => {
    const saved = storage();
    const state = createDefaultTwitchState();
    state.rewards.gameOrChance = {
      rewardId: 'reward-game',
      title: 'Моя нагорода',
      cost: 250,
      maxPerStream: 12
    };

    expect(saveTwitchState(saved, state)).toEqual({ value: state, error: null });
    expect(loadTwitchState(saved)).toEqual({ value: state, error: null });
  });

  test.each([
    ['malformed JSON', '{', 'INVALID_STORAGE'],
    ['unsupported schema', JSON.stringify({ schemaVersion: 2 }), 'UNSUPPORTED_SCHEMA'],
    ['invalid reward title', JSON.stringify({
      ...createDefaultTwitchState(),
      rewards: {
        ...createDefaultTwitchState().rewards,
        chanceOnly: {
          ...createDefaultTwitchState().rewards.chanceOnly,
          title: ''
        }
      }
    }), 'INVALID_STORAGE']
  ])('%s falls back to safe defaults', (_label, raw, code) => {
    const result = loadTwitchState(storage({ [TWITCH_STATE_KEY]: raw }));

    expect(result.value).toEqual(createDefaultTwitchState());
    expect(result.error.code).toBe(code);
  });

  test('duplicate pending redemption IDs invalidate saved state', () => {
    const state = createDefaultTwitchState();
    const duplicate = redemption('same-id', '2026-08-20T18:00:00.000Z');
    state.pending = [duplicate, duplicate];

    const result = loadTwitchState(storage({
      [TWITCH_STATE_KEY]: JSON.stringify(state)
    }));

    expect(result.value).toEqual(createDefaultTwitchState());
    expect(result.error.code).toBe('INVALID_STORAGE');
  });
});

describe('Twitch queue transitions', () => {
  test('merge adds unseen requests in redemption order', () => {
    const state = createDefaultTwitchState();
    state.pending = [redemption('pending', '2026-08-20T18:02:00.000Z')];
    state.handledRedemptionIds = ['handled'];

    const result = mergePending(state, [
      redemption('handled', '2026-08-20T17:59:00.000Z'),
      redemption('pending', '2026-08-20T18:02:00.000Z'),
      redemption('newer', '2026-08-20T18:03:00.000Z'),
      redemption('older', '2026-08-20T18:01:00.000Z')
    ]);

    expect(result.pending.map(item => item.id)).toEqual(['older', 'pending', 'newer']);
    expect(state.pending.map(item => item.id)).toEqual(['pending']);
  });

  test('resolution moves one request to newest-first history', () => {
    const state = createDefaultTwitchState();
    state.pending = [redemption('request-1', '2026-08-20T18:00:00.000Z')];

    const result = resolvePending(
      state,
      'request-1',
      { action: 'game-added', gameId: 7, gameName: 'Hades II' },
      () => new Date('2026-08-20T19:30:00.000Z')
    );

    expect(result.pending).toEqual([]);
    expect(result.handledRedemptionIds).toEqual(['request-1']);
    expect(result.history).toEqual([{
      ...state.pending[0],
      handledAt: '2026-08-20T19:30:00.000Z',
      action: 'game-added',
      gameId: 7,
      gameName: 'Hades II'
    }]);
  });

  test('history keeps only the newest 50 resolutions', () => {
    let state = createDefaultTwitchState();
    state.pending = Array.from({ length: 51 }, (_, index) => redemption(
      `request-${index + 1}`,
      `2026-08-20T18:${String(index).padStart(2, '0')}:00.000Z`
    ));

    for (let index = 1; index <= 51; index += 1) {
      state = resolvePending(
        state,
        `request-${index}`,
        { action: 'discarded' },
        () => new Date(`2026-08-20T20:${String(index).padStart(2, '0')}:00.000Z`)
      );
    }

    expect(state.history).toHaveLength(50);
    expect(state.history[0].id).toBe('request-51');
    expect(state.history.at(-1).id).toBe('request-2');
    expect(state.handledRedemptionIds).toHaveLength(51);
  });

  test('clear history preserves rewards, pending, and handled IDs', () => {
    const state = createDefaultTwitchState();
    state.pending = [redemption('pending', '2026-08-20T18:00:00.000Z')];
    state.history = [{
      ...redemption('handled', '2026-08-20T17:00:00.000Z'),
      handledAt: '2026-08-20T19:00:00.000Z',
      action: 'discarded',
      gameId: null,
      gameName: null
    }];
    state.handledRedemptionIds = ['handled'];

    expect(clearRequestHistory(state)).toEqual({ ...state, history: [] });
  });

  test('handled tombstones retain only still-unfulfilled IDs', () => {
    const state = createDefaultTwitchState();
    state.handledRedemptionIds = ['still-open', 'resolved-in-twitch'];

    const result = reconcileHandledIds(state, ['still-open', 'new-unhandled']);

    expect(result.handledRedemptionIds).toEqual(['still-open']);
  });
});
