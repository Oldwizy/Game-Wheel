import { addHistorySnapshot, createDefaultState, loadHistory, loadState, saveState } from '../core/state.js';
import { changeCopies } from '../core/game-rules.js';
import { normalizeName } from '../shared/presentation.js';
import { createGameListView } from './game-list-view.js';
import { createTwitchRewardView } from './twitch-reward-view.js';
import { createTwitchRequestView } from './twitch-request-view.js';
import { createTwitchIntegration } from '../integrations/twitch.js';
import {
  clearRequestHistory,
  loadTwitchState,
  mergePending,
  reconcileHandledIds,
  resolvePending,
  saveTwitchState
} from '../integrations/twitch-queue-state.js';
import { applyRequestAction } from '../integrations/twitch-request-rules.js';

const id = value => document.getElementById(value);
const ui = {
  input: id('gameInput'), copies: id('copiesInput'), add: id('addBtn'), reset: id('resetAllBtn'),
  lock: id('lockBtn'), startHint: id('startHint'), actionStatus: id('buildStatus'),
  tickets: id('tickets'), empty: id('emptyNote'), listHead: id('listHead'), historyBlock: id('historyBlock'),
  historyList: id('historyList'), historyEmpty: id('historyEmpty'), storage: id('storageStatus'),
  workspace: document.querySelector('.workspace')
};

let { value: state } = loadState(localStorage);
let history = loadHistory(localStorage).value;
let { value: twitchState, error: twitchStorageError } = loadTwitchState(localStorage);
let twitchUser = null;
let rewardStatuses = {};
let connectionStatus = { state: 'muted', message: 'Прослуховування вимкнено' };
let refreshingRequests = false;
let refreshStatus = null;
let cleanedUp = false;
let startingDraw = false;
let copiedHistory = null;
let currentMainTab = 'home';

const gameListView = createGameListView(ui, {
  onRemove: remove,
  onCopyDelta: copies,
  onCopyHistory: copyHistory
});

const rewardView = createTwitchRewardView(document, {
  onCreate: createReward,
  onDelete: deleteReward
});

const requestView = createTwitchRequestView(document, {
  onResolve: resolveRequest,
  onRefresh: refreshRequests,
  onClearHistory: () => {
    twitchState = clearRequestHistory(twitchState);
    persistTwitch();
    render();
  }
});

const twitch = createTwitchIntegration({
  onRedemption(redemption) {
    twitchState = mergePending(twitchState, [redemption]);
    persistTwitch();
    render();
  },
  onStatus(status) {
    if (status.scope === 'connection') {
      connectionStatus = status;
    } else if (status.type) {
      rewardStatuses = { ...rewardStatuses, [status.type]: status };
    }
    render();
  }
});

function persist() {
  const result = saveState(localStorage, state);
  ui.storage.hidden = !result.error;
  ui.storage.textContent = result.error ? 'Не вдалося зберегти зміни.' : '';
}

function persistTwitch() {
  const result = saveTwitchState(localStorage, twitchState);
  if (result.error) {
    ui.storage.hidden = false;
    ui.storage.textContent = 'Не вдалося зберегти Twitch-заявки.';
  }
}

function render() {
  gameListView.render(state, history);
  ui.add.textContent = copiedHistory ? 'Вставити список' : 'Додати до пулу';
  document.querySelectorAll('[data-main-tab]').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mainTab === currentMainTab);
    tab.toggleAttribute('aria-current', tab.dataset.mainTab === currentMainTab);
  });
  document.querySelectorAll('[data-main-pane]').forEach(pane => {
    pane.hidden = pane.dataset.mainPane !== currentMainTab;
  });
  ui.workspace.classList.toggle('authenticated', Boolean(twitchUser));
  id('twitchRequests').hidden = !twitchUser;
  id('twitchPanel').hidden = !twitchUser;
  id('twitchHeaderLogin').hidden = Boolean(twitchUser);
  id('twitchHeaderUser').hidden = !twitchUser;
  if (twitchUser) id('twitchHeaderName').textContent = `@${twitchUser.login}`;
  rewardView.render({
    user: twitchUser,
    rewards: twitchState.rewards,
    statuses: rewardStatuses,
    connectionStatus
  });
  requestView.render(twitchState, state.games, {
    refreshing: refreshingRequests,
    status: refreshStatus
  });
}

function copiesWord(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'копій';
  if (last === 1) return 'копію';
  if (last >= 2 && last <= 4) return 'копії';
  return 'копій';
}

function addGame(rawName, count = 1, addedBy = null) {
  const name = normalizeName(rawName);
  const parsedCount = Math.max(1, Number.parseInt(count, 10) || 1);
  if (!name) return;
  const existing = state.games.find(game => normalizeName(game.name).toLowerCase() === name.toLowerCase());
  state = existing
    ? { ...state, games: changeCopies(state.games, existing.id, parsedCount) }
    : {
        ...state,
        nextId: state.nextId + 1,
        games: [...state.games, { id: state.nextId, name, copies: parsedCount, addedBy }]
      };
  ui.actionStatus.textContent = existing
    ? `Для «${existing.name}» додано ще ${parsedCount} ${copiesWord(parsedCount)}.`
    : `«${name}» додано.`;
  persist();
  render();
}

function remove(gameId) {
  state = { ...state, games: state.games.filter(game => game.id !== gameId) };
  persist();
  render();
}

function copies(gameId, delta) {
  const game = state.games.find(item => item.id === gameId);
  if (!game || game.copies + delta < 1) return;
  state = { ...state, games: changeCopies(state.games, gameId, delta) };
  persist();
  render();
}

function archive() {
  addHistorySnapshot(localStorage, state.games);
  history = loadHistory(localStorage).value;
}

function copyHistory(entryId) {
  const entry = history.find(item => item.id === entryId);
  if (!entry) return;
  copiedHistory = entry.games.map(game => ({ name: game.name, copies: game.copies }));
  currentMainTab = 'home';
  ui.actionStatus.textContent = 'Список скопійовано. Натисніть «Вставити список», щоб завантажити його.';
  render();
}

function pasteCopiedHistory() {
  if (!copiedHistory) return;
  if (!confirm('Вставити скопійований список? Усі поточні записи буде стерто.')) {
    copiedHistory = null;
    ui.actionStatus.textContent = 'Вставку списку скасовано.';
    render();
    return;
  }
  let nextId = state.nextId;
  const games = copiedHistory.map(game => ({ id: nextId++, name: game.name, copies: game.copies }));
  state = { ...state, nextId, games };
  copiedHistory = null;
  ui.actionStatus.textContent = 'Список вставлено.';
  persist();
  render();
}

async function createReward(type, config) {
  rewardStatuses = { ...rewardStatuses, [type]: { state: 'pending', message: 'Створюємо нагороду…' } };
  render();
  try {
    const reward = await twitch.createReward(type, config);
    twitchState = {
      ...twitchState,
      rewards: {
        ...twitchState.rewards,
        [type]: {
          rewardId: reward.id,
          title: reward.title ?? config.title,
          cost: reward.cost ?? config.cost,
          maxPerUserPerStream: config.maxPerUserPerStream
        }
      }
    };
    rewardStatuses = {
      ...rewardStatuses,
      [type]: { state: 'ok', message: 'Нагороду додано. Чат може починати замовляти.' }
    };
    persistTwitch();
    twitch.syncRewards(twitchState.rewards);
    connectionStatus = { state: 'pending', message: 'Підключаємо Twitch-заявки…' };
  } catch (error) {
    rewardStatuses = {
      ...rewardStatuses,
      [type]: { state: 'error', message: `Не вдалося додати нагороду: ${error.message}` }
    };
  }
  render();
}

async function deleteReward(type, rewardId) {
  rewardStatuses = { ...rewardStatuses, [type]: { state: 'pending', message: 'Видаляємо нагороду…' } };
  render();
  try {
    await twitch.deleteReward(type, rewardId);
    twitchState = {
      ...twitchState,
      rewards: {
        ...twitchState.rewards,
        [type]: { ...twitchState.rewards[type], rewardId: null }
      }
    };
    rewardStatuses = { ...rewardStatuses, [type]: { state: 'ok', message: 'Нагороду видалено з Twitch.' } };
    persistTwitch();
    twitch.syncRewards(twitchState.rewards);
  } catch (error) {
    rewardStatuses = {
      ...rewardStatuses,
      [type]: { state: 'error', message: `Не вдалося видалити нагороду: ${error.message}` }
    };
  }
  render();
}

function resolveRequest(redemptionId, action) {
  const request = twitchState.pending.find(item => item.id === redemptionId);
  if (!request) return;
  try {
    let resolution = { action: 'discarded', gameId: null, gameName: null };
    if (action !== 'discard') {
      const result = applyRequestAction(state, request, action);
      state = result.state;
      resolution = {
        action: action === 'add-game' ? 'game-added' : 'chance-added',
        gameId: result.resolvedGame.id,
        gameName: result.resolvedGame.name
      };
      persist();
    }
    twitchState = resolvePending(twitchState, redemptionId, resolution);
    persistTwitch();
    render();
  } catch (error) {
    ui.actionStatus.textContent = `Заявка вже застаріла: ${error.message}`;
    render();
  }
}

async function refreshRequests() {
  if (refreshingRequests || !twitchUser) return;
  refreshingRequests = true;
  refreshStatus = { state: 'pending', message: 'Підтягуємо свіжі заявки…' };
  render();
  try {
    const pendingBefore = twitchState.pending.length;
    const result = await twitch.refreshRedemptions();
    twitchState = mergePending(twitchState, result.reconciledRedemptions);
    if (Array.isArray(result.unfulfilledRedemptionIds)) {
      twitchState = reconcileHandledIds(twitchState, result.unfulfilledRedemptionIds);
    }
    const added = twitchState.pending.length - pendingBefore;
    refreshStatus = { state: 'ok', message: `Заявки оновлено: нових — ${added}.` };
    persistTwitch();
  } catch (error) {
    refreshStatus = { state: 'error', message: `Не вдалося оновити заявки: ${error.message}` };
  } finally {
    refreshingRequests = false;
    render();
  }
}

async function initializeTwitch() {
  if (twitchStorageError) {
    ui.storage.hidden = false;
    ui.storage.textContent = 'Збережені Twitch-заявки пошкоджені, тому чергу відновлено з нуля.';
  }
  try {
    const result = await twitch.init(twitchState.rewards);
    twitchUser = result.user;
    if (result.oauthError) {
      connectionStatus = { state: 'error', message: result.oauthError.message };
    }
    twitchState = { ...twitchState, rewards: result.verifiedSlots };
    twitchState = mergePending(twitchState, result.reconciledRedemptions);
    if (twitchUser && Array.isArray(result.unfulfilledRedemptionIds)) {
      twitchState = reconcileHandledIds(twitchState, result.unfulfilledRedemptionIds);
    }
    persistTwitch();
    if (twitchUser) {
      twitch.syncRewards(twitchState.rewards);
      const hasRewards = Object.values(twitchState.rewards).some(reward => reward.rewardId);
      connectionStatus = hasRewards
        ? { state: 'pending', message: 'Підключаємо Twitch-заявки…' }
        : { state: 'muted', message: 'Додай хоча б одну нагороду, щоб слухати заявки.' };
    }
  } catch (error) {
    connectionStatus = { state: 'error', message: `Помилка Twitch: ${error.message}` };
  }
  render();
}

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  gameListView.destroy();
  rewardView.destroy();
  requestView.destroy();
  twitch.destroy();
}

async function deleteCreatedRewards() {
  const configured = Object.entries(twitchState.rewards)
    .filter(([, reward]) => reward.rewardId);
  const results = await Promise.allSettled(configured.map(([type, reward]) => (
    twitch.deleteReward(type, reward.rewardId)
  )));
  let rewards = twitchState.rewards;
  const failures = [];
  results.forEach((result, index) => {
    const [type, reward] = configured[index];
    if (result.status === 'rejected') {
      failures.push(reward.title);
      return;
    }
    rewards = {
      ...rewards,
      [type]: { ...reward, rewardId: null }
    };
  });
  if (rewards !== twitchState.rewards) {
    twitchState = { ...twitchState, rewards };
    persistTwitch();
  }
  return failures;
}

ui.add.addEventListener('click', () => {
  if (copiedHistory) {
    pasteCopiedHistory();
    return;
  }
  addGame(ui.input.value, ui.copies.value);
  ui.input.value = '';
  ui.copies.value = '1';
  ui.input.focus();
});
document.getElementById('twitchHeaderLogin').addEventListener('click', () => twitch.login());
document.getElementById('twitchLogoutBtn').addEventListener('click', () => {
  twitch.logout();
  twitchUser = null;
  connectionStatus = { state: 'muted', message: 'Прослуховування вимкнено' };
  ui.actionStatus.textContent = 'Ви вийшли з Twitch.';
  render();
});
document.querySelectorAll('[data-main-tab]').forEach(tab => tab.addEventListener('click', event => {
  event.preventDefault();
  currentMainTab = tab.dataset.mainTab;
  render();
}));
document.querySelectorAll('[data-side-tab]').forEach(tab => tab.addEventListener('click', () => {
  const name = tab.dataset.sideTab;
  document.querySelectorAll('[data-side-tab]').forEach(item => {
    item.classList.toggle('active', item === tab);
    item.setAttribute('aria-selected', String(item === tab));
  });
  document.querySelectorAll('[data-side-pane]').forEach(pane => { pane.hidden = pane.dataset.sidePane !== name; });
}));
[ui.input, ui.copies].forEach(input => input.addEventListener('keydown', event => {
  if (event.key === 'Enter') ui.add.click();
}));
ui.reset.addEventListener('click', () => {
  if (!confirm('Скинути все й почати заново? Буде очищено список, налаштування та прогрес.')) return;
  archive();
  state = createDefaultState();
  ui.actionStatus.textContent = 'Усе скинуто. Починаємо новий скам.';
  persist();
  render();
});
ui.lock.addEventListener('click', async () => {
  if (startingDraw) return;
  startingDraw = true;
  ui.lock.disabled = true;
  twitch.destroy();
  const failedRewards = twitchUser ? await deleteCreatedRewards() : [];
  archive();
  state = { ...state, roundCount: 0, logEntries: [] };
  persist();
  if (failedRewards.length) {
    alert(`Не вдалося видалити з Twitch: ${failedRewards.join(', ')}. Перевір нагороди вручну.`);
  }
  location.href = 'draw.html';
});

window.addEventListener('pagehide', cleanup, { once: true });
render();
void initializeTwitch();
