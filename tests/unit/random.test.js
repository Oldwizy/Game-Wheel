import { expect, test } from 'vitest';
import { shuffle, shuffleNoAdjacent, weightedPick } from '../../src/core/random.js';

test('weightedPick observes exact ticket boundaries', () => {
  const games = [{ id: 1, copies: 1 }, { id: 2, copies: 3 }];

  expect(weightedPick(games, () => 0).id).toBe(1);
  expect(weightedPick(games, () => 0.249999).id).toBe(1);
  expect(weightedPick(games, () => 0.25).id).toBe(2);
  expect(weightedPick(games, () => 0.999999).id).toBe(2);
});

test('weightedPick rejects pools without a positive integer ticket', () => {
  expect(() => weightedPick([], () => 0)).toThrow(RangeError);
  expect(() => weightedPick([{ id: 1, copies: 0 }], () => 0)).toThrow(RangeError);
});

test('shuffle is deterministic with injected randomness and keeps its input intact', () => {
  const items = Object.freeze([1, 2, 3]);

  expect(shuffle(items, () => 0)).toEqual([2, 3, 1]);
  expect(items).toEqual([1, 2, 3]);
});

test('shuffleNoAdjacent separates feasible duplicate keys on a circle', () => {
  const items = [{ id: 1 }, { id: 1 }, { id: 2 }, { id: 2 }];

  const result = shuffleNoAdjacent(items, item => item.id, { circular: true }, () => 0);

  result.forEach((item, index) => {
    expect(item.id).not.toBe(result[(index + 1) % result.length].id);
  });
});
