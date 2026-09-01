import test from 'node:test';
import assert from 'node:assert/strict';
import { RoundController } from '../src/draw/round-controller.js';
import { resolveCardsWinner } from '../src/core/game-rules.js';

test('finish marks an externally completed mode as finished', () => {
  const phases = [];
  const controller = new RoundController({
    selectTarget: () => null,
    visualizationFor: () => null,
    commitResult: async () => ({ finished: false }),
    onPhaseChange: phase => phases.push(phase),
    onError: () => {}
  });

  controller.finish();

  assert.equal(controller.phase, 'finished');
  assert.deepEqual(phases, ['finished']);
});

test('uses the restored finished phase for a completed persisted round', () => {
  const controller = new RoundController({
    selectTarget: () => null,
    visualizationFor: () => null,
    commitResult: async () => ({ finished: false }),
    onPhaseChange: () => {},
    onError: () => {},
    initialPhase: 'finished'
  });

  assert.equal(controller.phase, 'finished');
});

test('resolveCardsWinner retains only the revealed final card', () => {
  const result = resolveCardsWinner([
    { id: 1, name: 'Hades', copies: 2 },
    { id: 2, name: 'Hollow Knight', copies: 1 }
  ], 2);

  assert.deepEqual(result.games, [{ id: 2, name: 'Hollow Knight', copies: 1 }]);
  assert.deepEqual(result.eliminatedIds, [1]);
});
