export const TWITCH_STATE_KEY = 'twitch_rewards_state_v1';
export const REWARD_TYPES = Object.freeze({
  GAME_OR_CHANCE: 'gameOrChance',
  CHANCE_ONLY: 'chanceOnly'
});

const SCHEMA_VERSION = 1;
const MAX_HISTORY = 50;
const RESOLUTION_ACTIONS = new Set(['game-added', 'chance-added', 'discarded']);
const REWARD_TYPE_VALUES = new Set(Object.values(REWARD_TYPES));
const DEFAULT_REWARD_TITLES = Object.freeze({
  [REWARD_TYPES.GAME_OR_CHANCE]: 'Додати гру або копію',
  [REWARD_TYPES.CHANCE_ONLY]: 'Додати тільки копію'
});
const LEGACY_DEFAULT_REWARD_TITLES = Object.freeze({
  [REWARD_TYPES.GAME_OR_CHANCE]: 'Додати гру або шанс',
  [REWARD_TYPES.CHANCE_ONLY]: 'Додати тільки шанс'
});

export function createDefaultTwitchState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    rewards: {
      [REWARD_TYPES.GAME_OR_CHANCE]: {
        rewardId: null,
        title: DEFAULT_REWARD_TITLES[REWARD_TYPES.GAME_OR_CHANCE],
        cost: 100,
        maxPerStream: null
      },
      [REWARD_TYPES.CHANCE_ONLY]: {
        rewardId: null,
        title: DEFAULT_REWARD_TITLES[REWARD_TYPES.CHANCE_ONLY],
        cost: 100,
        maxPerStream: null
      }
    },
    pending: [],
    history: [],
    handledRedemptionIds: []
  };
}

function diagnostic(code, message, cause) {
  return { code, message, ...(cause ? { cause } : {}) };
}

function isRewardConfig(config) {
  return Boolean(
    config
    && (config.rewardId === null || (typeof config.rewardId === 'string' && config.rewardId.length > 0))
    && typeof config.title === 'string'
    && config.title.trim().length >= 1
    && config.title.trim().length <= 45
    && Number.isInteger(config.cost)
    && config.cost >= 1
    && (config.maxPerStream === null || (Number.isInteger(config.maxPerStream) && config.maxPerStream >= 1))
  );
}

function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isPendingRequest(request) {
  return Boolean(
    request
    && typeof request.id === 'string'
    && request.id.length > 0
    && REWARD_TYPE_VALUES.has(request.rewardType)
    && typeof request.rewardId === 'string'
    && request.rewardId.length > 0
    && typeof request.rewardTitle === 'string'
    && request.rewardTitle.length > 0
    && typeof request.viewerId === 'string'
    && request.viewerId.length > 0
    && typeof request.viewerName === 'string'
    && request.viewerName.length > 0
    && typeof request.input === 'string'
    && request.input.trim().length > 0
    && isTimestamp(request.redeemedAt)
    && isTimestamp(request.receivedAt)
  );
}

function isHistoryEntry(entry) {
  if (!isPendingRequest(entry) || !isTimestamp(entry.handledAt) || !RESOLUTION_ACTIONS.has(entry.action)) {
    return false;
  }
  if (entry.action === 'discarded') return entry.gameId === null && entry.gameName === null;
  return Number.isInteger(entry.gameId)
    && entry.gameId > 0
    && typeof entry.gameName === 'string'
    && entry.gameName.trim().length > 0;
}

function hasUniqueStrings(values) {
  return values.every(value => typeof value === 'string' && value.length > 0)
    && new Set(values).size === values.length;
}

function migrateLegacyDefaultTitles(value) {
  if (!value?.rewards) return value;
  let rewards = value.rewards;
  for (const type of REWARD_TYPE_VALUES) {
    const config = rewards[type];
    if (config?.rewardId !== null || config.title !== LEGACY_DEFAULT_REWARD_TITLES[type]) continue;
    if (rewards === value.rewards) rewards = { ...rewards };
    rewards[type] = { ...config, title: DEFAULT_REWARD_TITLES[type] };
  }
  return rewards === value.rewards ? value : { ...value, rewards };
}

function normalizeState(value) {
  if (
    !value
    || value.schemaVersion !== SCHEMA_VERSION
    || !isRewardConfig(value.rewards?.[REWARD_TYPES.GAME_OR_CHANCE])
    || !isRewardConfig(value.rewards?.[REWARD_TYPES.CHANCE_ONLY])
    || !Array.isArray(value.pending)
    || !value.pending.every(isPendingRequest)
    || new Set(value.pending.map(request => request.id)).size !== value.pending.length
    || !Array.isArray(value.history)
    || value.history.length > MAX_HISTORY
    || !value.history.every(isHistoryEntry)
    || new Set(value.history.map(entry => entry.id)).size !== value.history.length
    || !Array.isArray(value.handledRedemptionIds)
    || !hasUniqueStrings(value.handledRedemptionIds)
    || value.pending.some(request => value.handledRedemptionIds.includes(request.id))
  ) {
    return null;
  }
  return value;
}

export function loadTwitchState(storage = localStorage) {
  const defaults = createDefaultTwitchState();
  let raw;
  try {
    raw = storage.getItem(TWITCH_STATE_KEY);
  } catch (error) {
    return { value: defaults, error: diagnostic('STORAGE_READ', 'Unable to read Twitch state', error) };
  }
  if (!raw) return { value: defaults, error: null };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { value: defaults, error: diagnostic('INVALID_STORAGE', 'Saved Twitch state is not valid JSON', error) };
  }
  if (Number.isInteger(parsed?.schemaVersion) && parsed.schemaVersion > SCHEMA_VERSION) {
    return { value: defaults, error: diagnostic('UNSUPPORTED_SCHEMA', 'Saved Twitch state uses a newer schema') };
  }
  const value = normalizeState(migrateLegacyDefaultTitles(parsed));
  return value
    ? { value, error: null }
    : { value: defaults, error: diagnostic('INVALID_STORAGE', 'Saved Twitch state failed validation') };
}

export function saveTwitchState(storage = localStorage, state) {
  const value = normalizeState(state);
  if (!value) return { value: state, error: diagnostic('INVALID_STATE', 'Twitch state failed validation') };
  try {
    storage.setItem(TWITCH_STATE_KEY, JSON.stringify(value));
    return { value, error: null };
  } catch (error) {
    return { value: state, error: diagnostic('STORAGE_WRITE', 'Unable to write Twitch state', error) };
  }
}

export function mergePending(state, redemptions) {
  if (!Array.isArray(redemptions) || !redemptions.every(isPendingRequest)) {
    throw new TypeError('Twitch redemptions are invalid');
  }
  const excluded = new Set([
    ...state.pending.map(request => request.id),
    ...state.handledRedemptionIds
  ]);
  const additions = [];
  for (const redemption of redemptions) {
    if (excluded.has(redemption.id)) continue;
    excluded.add(redemption.id);
    additions.push({ ...redemption });
  }
  if (!additions.length) return state;
  const pending = [...state.pending, ...additions].sort((left, right) => (
    Date.parse(left.redeemedAt) - Date.parse(right.redeemedAt)
    || left.id.localeCompare(right.id)
  ));
  return { ...state, pending };
}

export function resolvePending(
  state,
  redemptionId,
  { action, gameId = null, gameName = null },
  now = () => new Date()
) {
  const request = state.pending.find(item => item.id === redemptionId);
  if (!request) throw new RangeError(`Unknown Twitch redemption ${redemptionId}`);
  const isGameAction = action === 'game-added' || action === 'chance-added';
  if (
    !RESOLUTION_ACTIONS.has(action)
    || (isGameAction && (!Number.isInteger(gameId) || gameId <= 0 || typeof gameName !== 'string' || !gameName.trim()))
    || (!isGameAction && (gameId !== null || gameName !== null))
  ) {
    throw new TypeError('Twitch resolution is invalid');
  }
  const timestamp = now();
  const handledAt = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(handledAt.getTime())) throw new TypeError('Twitch resolution time is invalid');

  const historyEntry = {
    ...request,
    handledAt: handledAt.toISOString(),
    action,
    gameId: isGameAction ? gameId : null,
    gameName: isGameAction ? gameName : null
  };
  return {
    ...state,
    pending: state.pending.filter(item => item.id !== redemptionId),
    history: [historyEntry, ...state.history].slice(0, MAX_HISTORY),
    handledRedemptionIds: state.handledRedemptionIds.includes(redemptionId)
      ? state.handledRedemptionIds
      : [...state.handledRedemptionIds, redemptionId]
  };
}

export function clearRequestHistory(state) {
  return state.history.length ? { ...state, history: [] } : state;
}

export function reconcileHandledIds(state, unfulfilledIds) {
  if (!Array.isArray(unfulfilledIds) || !hasUniqueStrings(unfulfilledIds)) {
    throw new TypeError('Unfulfilled Twitch redemption IDs are invalid');
  }
  const unfulfilled = new Set(unfulfilledIds);
  const handledRedemptionIds = state.handledRedemptionIds.filter(id => unfulfilled.has(id));
  return handledRedemptionIds.length === state.handledRedemptionIds.length
    ? state
    : { ...state, handledRedemptionIds };
}
