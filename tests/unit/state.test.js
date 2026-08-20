import { describe, expect, test } from 'vitest';
import { createMemoryStorage } from '../helpers/memory-storage.js';
import {
  CURRENT_SCHEMA_VERSION,
  HISTORY_KEY,
  STATE_KEY,
  addHistorySnapshot,
  createDefaultState,
  loadHistory,
  loadState,
  saveState
} from '../../src/core/state.js';

describe('state persistence', () => {
  test('migrates a legacy state without schemaVersion from v0 to current', () => {
    const legacy = { games: [{ id: 1, name: 'Alpha', copies: 2 }], nextId: 2 };
    const storage = createMemoryStorage({ [STATE_KEY]: JSON.stringify(legacy) });

    const { value, error } = loadState(storage);

    expect(error).toBeNull();
    expect(value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(value.games).toEqual(legacy.games);
    expect(value.visualMode).toBe('slot');
    expect(JSON.parse(storage.dump()[STATE_KEY])).toEqual(value);
  });

  test('migrates the legacy history array into a versioned envelope', () => {
    const legacy = [{ id: 7, savedAt: '2026-01-01T00:00:00.000Z', games: [] }];
    const storage = createMemoryStorage({ [HISTORY_KEY]: JSON.stringify(legacy) });

    expect(loadHistory(storage)).toEqual({ value: legacy, error: null });
    expect(JSON.parse(storage.dump()[HISTORY_KEY])).toEqual({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      entries: legacy
    });
  });

  test('does not overwrite an unknown future state version', () => {
    const raw = JSON.stringify({ schemaVersion: 999, games: [] });
    const storage = createMemoryStorage({ [STATE_KEY]: raw });

    const result = loadState(storage);

    expect(result.value).toEqual(createDefaultState());
    expect(result.error.code).toBe('UNSUPPORTED_SCHEMA');
    expect(storage.dump()[STATE_KEY]).toBe(raw);
  });

  test('returns defaults and a diagnostic for malformed JSON', () => {
    const storage = createMemoryStorage({ [STATE_KEY]: '{not-json' });

    const result = loadState(storage);

    expect(result.value).toEqual(createDefaultState());
    expect(result.error.code).toBe('INVALID_STORAGE');
  });

  test('rejects invalid games instead of leaking malformed state into page code', () => {
    const invalid = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      games: [{ id: 1, name: '', copies: 0 }],
      nextId: 2
    };
    const storage = createMemoryStorage({ [STATE_KEY]: JSON.stringify(invalid) });

    const result = loadState(storage);

    expect(result.value).toEqual(createDefaultState());
    expect(result.error.code).toBe('INVALID_STORAGE');
  });

  test('reports storage writes without losing the in-memory state', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); }
    };
    const state = createDefaultState();

    expect(saveState(storage, state)).toMatchObject({
      value: state,
      error: { code: 'STORAGE_WRITE' }
    });
  });

  test('history snapshots are newest-first, deduplicated, and limited to three', () => {
    const storage = createMemoryStorage();
    const games = [{ id: 9, name: 'Alpha', copies: 2 }];

    addHistorySnapshot(storage, games, () => new Date('2026-01-01T00:00:00.000Z'));
    addHistorySnapshot(storage, games, () => new Date('2026-01-02T00:00:00.000Z'));
    addHistorySnapshot(storage, [{ id: 10, name: 'Beta', copies: 1 }], () => new Date('2026-01-03T00:00:00.000Z'));
    addHistorySnapshot(storage, [{ id: 11, name: 'Gamma', copies: 1 }], () => new Date('2026-01-04T00:00:00.000Z'));
    const result = addHistorySnapshot(storage, [{ id: 12, name: 'Delta', copies: 3 }], () => new Date('2026-01-05T00:00:00.000Z'));

    expect(result.error).toBeNull();
    expect(result.value).toHaveLength(3);
    expect(result.value.map(entry => entry.games[0].name)).toEqual(['Delta', 'Gamma', 'Beta']);
    expect(result.value[0]).toEqual({
      id: 1767571200000,
      savedAt: '2026-01-05T00:00:00.000Z',
      games: [{ name: 'Delta', copies: 3 }]
    });
  });
});
