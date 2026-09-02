import test from 'node:test';
import assert from 'node:assert/strict';
import * as snackbar from '../src/draw/elimination-snackbar.js';

test('keeps one game title as the complete snackbar content', () => {
  assert.equal(typeof snackbar.formatEliminationSnackbar, 'function');
  assert.equal(snackbar.formatEliminationSnackbar('Alpha'), 'Alpha');
});
