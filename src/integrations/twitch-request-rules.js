import { normalizeName } from '../shared/presentation.js';
import { changeCopies } from '../core/game-rules.js';
import { REWARD_TYPES } from './twitch-queue-state.js';

function comparableName(value) {
  return normalizeName(value).toLocaleLowerCase('uk-UA');
}

export function findMatchingGame(games, viewerInput) {
  const expected = comparableName(viewerInput);
  if (!expected) return null;
  return games.find(game => comparableName(game.name) === expected) ?? null;
}

export function getRequestAction(request, games) {
  const input = normalizeName(request?.input);
  if (!input) return null;
  const match = findMatchingGame(games, input);
  if (match) return 'add-chance';
  return request?.rewardType === REWARD_TYPES.GAME_OR_CHANCE ? 'add-game' : null;
}

export function applyRequestAction(buildState, request, action) {
  const allowedAction = getRequestAction(request, buildState.games);
  if (!allowedAction || action !== allowedAction) {
    throw new RangeError(`Twitch request action ${action} is no longer available`);
  }

  if (action === 'add-game') {
    if (!Number.isInteger(buildState.nextId) || buildState.nextId < 1) {
      throw new TypeError('Build state nextId is invalid');
    }
    const game = {
      id: buildState.nextId,
      name: normalizeName(request.input),
      copies: 1
    };
    return {
      state: {
        ...buildState,
        nextId: buildState.nextId + 1,
        games: [...buildState.games, game]
      },
      resolvedGame: game
    };
  }

  const match = findMatchingGame(buildState.games, request.input);
  const games = changeCopies(buildState.games, match.id, 1);
  return {
    state: { ...buildState, games },
    resolvedGame: games.find(game => game.id === match.id)
  };
}
