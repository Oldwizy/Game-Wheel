import { describe, expect, test } from 'vitest';
import { REWARD_TYPES } from '../../src/integrations/twitch-queue-state.js';
import {
  applyRequestAction,
  findMatchingGame,
  getRequestAction
} from '../../src/integrations/twitch-request-rules.js';

const games = [{ id: 4, name: 'Cyberpunk 2077', copies: 2 }];

function request(rewardType, input) {
  return { rewardType, input };
}

describe('Twitch request action selection', () => {
  test.each([
    [REWARD_TYPES.GAME_OR_CHANCE, ' cyberPUNK   2077 ', 'add-chance'],
    [REWARD_TYPES.GAME_OR_CHANCE, 'Hades II', 'add-game'],
    [REWARD_TYPES.CHANCE_ONLY, 'CYBERPUNK 2077', 'add-chance'],
    [REWARD_TYPES.CHANCE_ONLY, 'Hades II', null],
    [REWARD_TYPES.GAME_OR_CHANCE, '   ', null]
  ])('%s with input %j resolves to %s', (rewardType, input, expected) => {
    expect(getRequestAction(request(rewardType, input), games)).toBe(expected);
  });

  test('matching returns the original game object without substring matching', () => {
    expect(findMatchingGame(games, ' cyberPUNK   2077 ')).toBe(games[0]);
    expect(findMatchingGame(games, 'Cyberpunk')).toBeNull();
  });
});

describe('Twitch request game mutations', () => {
  test('add-game creates one normalized copy with the next ID', () => {
    const buildState = { games: [...games], nextId: 5, roundCount: 0 };

    const result = applyRequestAction(
      buildState,
      request(REWARD_TYPES.GAME_OR_CHANCE, '  Hades   II '),
      'add-game'
    );

    expect(result.state).toEqual({
      ...buildState,
      nextId: 6,
      games: [...games, { id: 5, name: 'Hades II', copies: 1 }]
    });
    expect(result.resolvedGame).toEqual({ id: 5, name: 'Hades II', copies: 1 });
  });

  test('add-chance increments one copy and preserves the display name', () => {
    const buildState = { games: [...games], nextId: 5 };

    const result = applyRequestAction(
      buildState,
      request(REWARD_TYPES.CHANCE_ONLY, ' cyberPUNK   2077 '),
      'add-chance'
    );

    expect(result.state.games).toEqual([{ id: 4, name: 'Cyberpunk 2077', copies: 3 }]);
    expect(result.resolvedGame).toEqual({ id: 4, name: 'Cyberpunk 2077', copies: 3 });
  });

  test('stale actions are rejected against current game state', () => {
    expect(() => applyRequestAction(
      { games, nextId: 5 },
      request(REWARD_TYPES.GAME_OR_CHANCE, 'Cyberpunk 2077'),
      'add-game'
    )).toThrow(RangeError);

    expect(() => applyRequestAction(
      { games: [], nextId: 1 },
      request(REWARD_TYPES.CHANCE_ONLY, 'Hades II'),
      'add-chance'
    )).toThrow(RangeError);
  });
});
