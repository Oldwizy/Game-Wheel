import { getRequestAction } from '../integrations/twitch-request-rules.js';

const ACTION_LABELS = Object.freeze({
  'add-game': 'Додати гру',
  'add-chance': 'Додати копію'
});

export function createTwitchRequestView(root, {
  onResolve = () => {},
  onClearHistory = () => {},
  onRefresh = () => {}
} = {}) {
  const get = id => root.getElementById?.(id) ?? root.querySelector?.(`#${id}`);
  const document = root.createElement ? root : root.ownerDocument;
  const section = get('twitchRequests');
  let selectedTab = 'pending';
  let currentState = { pending: [], history: [] };
  let currentGames = [];
  let currentRefresh = { refreshing: false, status: null };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function timeLabel(value) {
    return new Intl.DateTimeFormat('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  function appendRequestIdentity(card, request, timestamp) {
    const meta = element('div', 'twitch-request-meta');
    meta.append(
      element('span', 'twitch-request-reward', request.rewardTitle),
      element('time', 'twitch-request-time', timeLabel(timestamp))
    );
    const viewer = element('div', 'twitch-request-viewer', request.viewerName);
    const input = element('div', 'twitch-request-input', request.input);
    card.append(meta, viewer, input);
  }

  function pendingCard(request) {
    const card = element('article', 'twitch-request-card');
    card.dataset.redemptionId = request.id;
    appendRequestIdentity(card, request, request.redeemedAt);
    const actions = element('div', 'twitch-request-actions');
    const primaryAction = getRequestAction(request, currentGames);
    if (primaryAction) {
      const primary = element('button', 'twitch-request-primary', ACTION_LABELS[primaryAction]);
      primary.type = 'button';
      primary.dataset.requestAction = primaryAction;
      actions.append(primary);
    } else {
      const copy = element('button', 'twitch-request-copy', 'Копіювати');
      copy.type = 'button';
      copy.dataset.copyRequest = request.id;
      actions.append(copy);
    }
    const discard = element('button', 'twitch-request-discard', 'Видалити');
    discard.type = 'button';
    discard.dataset.requestAction = 'discard';
    actions.append(discard);
    card.append(actions);
    return card;
  }

  function historyResult(entry) {
    if (entry.action === 'game-added') return `додано гру «${entry.gameName}»`;
    if (entry.action === 'chance-added') return `додано копію для «${entry.gameName}»`;
    return 'видалено';
  }

  function historyCard(entry) {
    const card = element('article', 'twitch-request-card twitch-request-card-history');
    card.dataset.redemptionId = entry.id;
    appendRequestIdentity(card, entry, entry.handledAt);
    card.append(element('div', `twitch-request-result ${entry.action}`, historyResult(entry)));
    return card;
  }

  function renderPanel(panel, items, cardFactory, emptyText) {
    panel.replaceChildren();
    if (!items.length) {
      panel.append(element('div', 'twitch-request-empty', emptyText));
      return;
    }
    const list = element('div', 'twitch-request-list');
    for (const item of items) list.append(cardFactory(item));
    panel.append(list);
  }

  function applySelectedTab() {
    const pendingSelected = selectedTab === 'pending';
    get('twitchPendingTab').setAttribute('aria-selected', String(pendingSelected));
    get('twitchHistoryTab').setAttribute('aria-selected', String(!pendingSelected));
    get('twitchPendingPanel').hidden = !pendingSelected;
    get('twitchHistoryPanel').hidden = pendingSelected;
  }

  function render() {
    const refresh = get('twitchRefreshBtn');
    refresh.disabled = currentRefresh.refreshing;
    const refreshStatus = get('twitchRefreshStatus');
    refreshStatus.hidden = !currentRefresh.status?.message;
    refreshStatus.textContent = currentRefresh.status?.message ?? '';
    refreshStatus.className = `twitch-refresh-status ${currentRefresh.status?.state ?? ''}`.trim();
    get('twitchPendingTab').textContent = `Нові · ${currentState.pending.length}`;
    get('twitchHistoryTab').textContent = `Історія · ${currentState.history.length}`;
    renderPanel(
      get('twitchPendingPanel'),
      currentState.pending,
      pendingCard,
      'Поки тихо. Чат ще нічого не замовив.'
    );
    const historyPanel = get('twitchHistoryPanel');
    renderPanel(
      historyPanel,
      currentState.history,
      historyCard,
      'Історія ще чиста, аж підозріло.'
    );
    const clear = element('button', 'link-btn danger twitch-clear-history', 'Очистити історію');
    clear.type = 'button';
    clear.id = 'twitchClearHistoryBtn';
    clear.hidden = currentState.history.length === 0;
    historyPanel.append(clear);
    applySelectedTab();
  }

  function selectTab(tab) {
    if (tab !== 'pending' && tab !== 'history') throw new TypeError('Невідома вкладка Twitch-заявок.');
    selectedTab = tab;
    applySelectedTab();
  }

  async function copyRequest(button) {
    const request = currentState.pending.find(item => item.id === button.dataset.copyRequest);
    if (!request) return;
    try {
      await root.defaultView?.navigator.clipboard.writeText(request.input);
      button.textContent = 'Скопійовано';
    } catch {
      button.textContent = 'Не скопійовано';
    }
  }

  function handleClick(event) {
    if (event.target.closest('#twitchRefreshBtn')) {
      void onRefresh();
      return;
    }
    if (event.target.closest('#twitchPendingTab')) {
      selectTab('pending');
      return;
    }
    if (event.target.closest('#twitchHistoryTab')) {
      selectTab('history');
      return;
    }
    if (event.target.closest('#twitchClearHistoryBtn')) {
      const confirmAction = root.defaultView?.confirm ?? globalThis.confirm;
      if (confirmAction('Очистити локальну історію Twitch-заявок?')) onClearHistory();
      return;
    }
    const copy = event.target.closest('[data-copy-request]');
    if (copy) {
      void copyRequest(copy);
      return;
    }
    const action = event.target.closest('[data-request-action]');
    const card = action?.closest('[data-redemption-id]');
    if (action && card) onResolve(card.dataset.redemptionId, action.dataset.requestAction);
  }

  section.addEventListener('click', handleClick);

  return {
    render(twitchState, games, refresh = {}) {
      currentState = twitchState;
      currentGames = games;
      currentRefresh = {
        refreshing: Boolean(refresh.refreshing),
        status: refresh.status ?? null
      };
      render();
    },
    selectTab,
    destroy() {
      section.removeEventListener('click', handleClick);
    }
  };
}
