export const STATE_KEY = 'lototron_state_v1';
export const HISTORY_KEY = 'lototron_history_v1';
export const CURRENT_SCHEMA_VERSION = 5;

const MAX_HISTORY = 15;

const stateMigrations = new Map([
  [0, legacy => ({
    schemaVersion: 1,
    games: Array.isArray(legacy.games) ? legacy.games : [],
    nextId: Number.isInteger(legacy.nextId) ? legacy.nextId : 1,
    roundCount: Number.isInteger(legacy.roundCount) ? legacy.roundCount : 0,
    logEntries: Array.isArray(legacy.logEntries) ? legacy.logEntries : [],
    visualMode: ['slot', 'wheel'].includes(legacy.visualMode) ? legacy.visualMode : 'slot',
    instantWinMode: Boolean(legacy.instantWinMode),
    durationValue: Number(legacy.durationValue) || 15
  })],
  [1, state => ({
    ...state,
    schemaVersion: 2,
    visualMode: state.visualMode === 'wheel' ? 'wheel' : 'slot'
  })],
  [2, state => ({
    ...state,
    schemaVersion: 3,
    visualMode: ['slot', 'wheel', 'mystery'].includes(state.visualMode) ? state.visualMode : 'slot'
  })],
  [3, state => ({
    ...state,
    schemaVersion: 4,
    visualMode: ['slot', 'wheel', 'mystery', 'cards'].includes(state.visualMode) ? state.visualMode : 'slot'
  })],
  [4, state => ({
    ...state,
    schemaVersion: 5,
    cardsSession: null
  })]
]);

const historyMigrations = new Map([
  [0, entries => ({
    schemaVersion: 1,
    entries: Array.isArray(entries) ? entries : []
  })],
  [1, history => ({ ...history, schemaVersion: 2 })],
  [2, history => ({ ...history, schemaVersion: 3 })],
  [3, history => ({ ...history, schemaVersion: 4 })],
  [4, history => ({ ...history, schemaVersion: 5 })]
]);

export function createDefaultState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    games: [],
    nextId: 1,
    roundCount: 0,
    logEntries: [],
    visualMode: 'slot',
    cardsSession: null,
    instantWinMode: false,
    durationValue: 15
  };
}

function diagnostic(code, message, cause) {
  return { code, message, ...(cause ? { cause } : {}) };
}

function migrate(payload, migrations) {
  const initialVersion = Array.isArray(payload)
    ? 0
    : payload?.schemaVersion ?? 0;

  if (!Number.isInteger(initialVersion) || initialVersion < 0) {
    return { value: null, migrated: false, error: diagnostic('INVALID_STORAGE', 'Invalid schema version') };
  }
  if (initialVersion > CURRENT_SCHEMA_VERSION) {
    return { value: null, migrated: false, error: diagnostic('UNSUPPORTED_SCHEMA', 'Saved data uses a newer schema') };
  }

  let value = payload;
  let version = initialVersion;
  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.get(version);
    if (!migration) {
      return { value: null, migrated: false, error: diagnostic('INVALID_STORAGE', `Missing migration from schema ${version}`) };
    }
    value = migration(value);
    version += 1;
  }
  return { value, migrated: version !== initialVersion, error: null };
}

function isGame(game) {
  return Boolean(
    game
    && Number.isInteger(game.id)
    && game.id > 0
    && typeof game.name === 'string'
    && game.name.trim().length > 0
    && Number.isInteger(game.copies)
    && game.copies > 0
  );
}

function isCardsSession(session) {
  return session === null || Boolean(
    session
    && Array.isArray(session.cards)
    && session.cards.every(card => (
      card
      && Number.isInteger(card.gameId)
      && card.gameId > 0
      && Number.isInteger(card.copyIndex)
      && card.copyIndex >= 0
      && typeof card.spent === 'boolean'
    ))
  );
}

function normalizeState(value) {
  if (!value || value.schemaVersion !== CURRENT_SCHEMA_VERSION || !Array.isArray(value.games) || !value.games.every(isGame)) {
    return null;
  }

  const defaults = createDefaultState();
  const normalized = { ...defaults, ...value, schemaVersion: CURRENT_SCHEMA_VERSION };
  if (!Number.isInteger(normalized.nextId) || normalized.nextId < 1) return null;
  if (!Number.isInteger(normalized.roundCount) || normalized.roundCount < 0) return null;
  if (!Array.isArray(normalized.logEntries)) return null;
  if (!['slot', 'wheel', 'mystery', 'cards'].includes(normalized.visualMode)) return null;
  if (!isCardsSession(normalized.cardsSession)) return null;
  if (typeof normalized.instantWinMode !== 'boolean') return null;
  if (!Number.isFinite(Number(normalized.durationValue)) || Number(normalized.durationValue) <= 0) return null;
  normalized.durationValue = Number(normalized.durationValue);
  return normalized;
}

function isHistoryGame(game) {
  return Boolean(
    game
    && typeof game.name === 'string'
    && game.name.trim().length > 0
    && Number.isInteger(game.copies)
    && game.copies > 0
  );
}

function normalizeHistory(value) {
  if (!value || value.schemaVersion !== CURRENT_SCHEMA_VERSION || !Array.isArray(value.entries)) return null;
  const valid = value.entries.every(entry => (
    entry
    && Number.isInteger(entry.id)
    && entry.id > 0
    && typeof entry.savedAt === 'string'
    && Array.isArray(entry.games)
    && entry.games.every(isHistoryGame)
  ));
  return valid ? value.entries : null;
}

function write(storage, key, payload, value) {
  try {
    storage.setItem(key, JSON.stringify(payload));
    return { value, error: null };
  } catch (error) {
    return { value, error: diagnostic('STORAGE_WRITE', 'Unable to write saved data', error) };
  }
}

function read(storage, key) {
  try {
    return { raw: storage.getItem(key), error: null };
  } catch (error) {
    return { raw: null, error: diagnostic('STORAGE_READ', 'Unable to read saved data', error) };
  }
}

export function loadState(storage = localStorage) {
  const defaults = createDefaultState();
  const readResult = read(storage, STATE_KEY);
  if (readResult.error) return { value: defaults, error: readResult.error };
  if (!readResult.raw) return { value: defaults, error: null };

  let parsed;
  try {
    parsed = JSON.parse(readResult.raw);
  } catch (error) {
    return { value: defaults, error: diagnostic('INVALID_STORAGE', 'Saved state is not valid JSON', error) };
  }

  const migration = migrate(parsed, stateMigrations);
  if (migration.error) return { value: defaults, error: migration.error };
  const value = normalizeState(migration.value);
  if (!value) return { value: defaults, error: diagnostic('INVALID_STORAGE', 'Saved state failed validation') };
  return migration.migrated ? saveState(storage, value) : { value, error: null };
}

export function saveState(storage = localStorage, state) {
  const value = normalizeState(state);
  if (!value) {
    return { value: state, error: diagnostic('INVALID_STATE', 'State failed validation') };
  }
  return write(storage, STATE_KEY, value, state);
}

export function loadHistory(storage = localStorage) {
  const readResult = read(storage, HISTORY_KEY);
  if (readResult.error) return { value: [], error: readResult.error };
  if (!readResult.raw) return { value: [], error: null };

  let parsed;
  try {
    parsed = JSON.parse(readResult.raw);
  } catch (error) {
    return { value: [], error: diagnostic('INVALID_STORAGE', 'Saved history is not valid JSON', error) };
  }

  const migration = migrate(parsed, historyMigrations);
  if (migration.error) return { value: [], error: migration.error };
  const entries = normalizeHistory(migration.value);
  if (!entries) return { value: [], error: diagnostic('INVALID_STORAGE', 'Saved history failed validation') };
  return migration.migrated ? saveHistory(storage, entries) : { value: entries, error: null };
}

export function saveHistory(storage = localStorage, entries) {
  const envelope = { schemaVersion: CURRENT_SCHEMA_VERSION, entries };
  const value = normalizeHistory(envelope);
  if (!value) {
    return { value: entries, error: diagnostic('INVALID_HISTORY', 'History failed validation') };
  }
  return write(storage, HISTORY_KEY, envelope, entries);
}

export function addHistorySnapshot(storage = localStorage, games, now = () => new Date()) {
  if (!Array.isArray(games) || games.length === 0) return loadHistory(storage);

  const loaded = loadHistory(storage);
  if (loaded.error) return loaded;
  const serialized = games.map(game => ({ name: game.name, copies: game.copies }));
  if (!serialized.every(isHistoryGame)) {
    return { value: loaded.value, error: diagnostic('INVALID_HISTORY', 'History snapshot failed validation') };
  }
  if (loaded.value[0] && JSON.stringify(loaded.value[0].games) === JSON.stringify(serialized)) {
    return loaded;
  }

  const timestamp = now();
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return { value: loaded.value, error: diagnostic('INVALID_HISTORY', 'History snapshot time is invalid') };
  }
  const entries = [{ id: date.getTime(), savedAt: date.toISOString(), games: serialized }, ...loaded.value].slice(0, MAX_HISTORY);
  return saveHistory(storage, entries);
}
