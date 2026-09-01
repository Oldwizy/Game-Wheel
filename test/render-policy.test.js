import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPreserveActiveVisualization } from '../src/draw/render-policy.js';

test('preserves a cards session while a catalog request completes', () => {
  assert.equal(shouldPreserveActiveVisualization({
    phase: 'idle',
    mode: 'cards',
    cardsHasProgress: true
  }), true);
});

test('does not preserve an untouched cards session', () => {
  assert.equal(shouldPreserveActiveVisualization({
    phase: 'idle',
    mode: 'cards',
    cardsHasProgress: false
  }), false);
});
