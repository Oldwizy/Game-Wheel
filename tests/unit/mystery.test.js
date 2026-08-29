import { expect, test } from 'vitest';
import { buildMysteryReel } from '../../src/draw/mystery.js';

test('Mystery reel places the preselected game under the final marker', () => {
  const games = [
    { id: 1, copies: 1 },
    { id: 2, copies: 2 },
    { id: 3, copies: 1 }
  ];

  const reel = buildMysteryReel({
    games,
    targetId: 2,
    viewportWidth: 600,
    durationMs: 2000,
    random: () => 0
  });

  expect(reel.items[reel.targetIndex].id).toBe(2);
  expect(reel.items.length - reel.targetIndex).toBeGreaterThan(3);
});
