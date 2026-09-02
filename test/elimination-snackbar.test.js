import test from 'node:test';
import assert from 'node:assert/strict';
import * as snackbar from '../src/draw/elimination-snackbar.js';

test('provides a short label above the eliminated game name', () => {
  assert.deepEqual(snackbar.eliminationSnackbarContent('Alpha'), {
    label: 'Вибув:',
    name: 'Alpha'
  });
});

test('keeps elimination snackbars visible for two seconds', () => {
  assert.equal(snackbar.ELIMINATION_SNACKBAR_DURATION_MS, 2000);
});
