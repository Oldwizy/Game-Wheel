import { expect, test } from 'vitest';
import {
  changeCopies,
  findTerminalWinner,
  removeRoundCopy,
  resolveInstantWinner,
  returnGame
} from '../../src/core/game-rules.js';

const games = Object.freeze([
  Object.freeze({ id: 1, name: 'Alpha', copies: 2 }),
  Object.freeze({ id: 2, name: 'Beta', copies: 1 })
]);

test('changeCopies returns a new collection and removes a game at zero', () => {
  const increased = changeCopies(games, 1, 1);
  const removed = changeCopies(games, 2, -1);

  expect(increased).toEqual([
    { id: 1, name: 'Alpha', copies: 3 },
    { id: 2, name: 'Beta', copies: 1 }
  ]);
  expect(removed).toEqual([games[0]]);
  expect(games[0].copies).toBe(2);
});

test('removeRoundCopy decrements then eliminates without mutating input', () => {
  expect(removeRoundCopy(games, 1).games[0].copies).toBe(1);
  expect(games[0].copies).toBe(2);
  const lastCopies = [{ id: 1, name: 'Alpha', copies: 1 }, games[1]];

  expect(removeRoundCopy(lastCopies, 1)).toMatchObject({
    eliminated: true,
    games: [games[1]]
  });
});

test('instant winner keeps only the selected game', () => {
  expect(resolveInstantWinner(games, 2).games).toEqual([games[1]]);
});

test('returned game is inserted once with one copy and increments an existing game', () => {
  const entry = { gameId: 9, gameName: 'Returned' };

  expect(returnGame(games, entry).filter(game => game.id === 9)).toEqual([
    { id: 9, name: 'Returned', copies: 1 }
  ]);
  expect(returnGame(games, { gameId: 1, gameName: 'Alpha' })[0].copies).toBe(3);
});

test('terminal winner exists only for exactly one game', () => {
  expect(findTerminalWinner([games[0]])).toEqual(games[0]);
  expect(findTerminalWinner(games)).toBeNull();
  expect(findTerminalWinner([])).toBeNull();
});

test('rules reject unknown game IDs', () => {
  expect(() => changeCopies(games, 99, 1)).toThrow(RangeError);
  expect(() => removeRoundCopy(games, 99)).toThrow(RangeError);
  expect(() => resolveInstantWinner(games, 99)).toThrow(RangeError);
});
