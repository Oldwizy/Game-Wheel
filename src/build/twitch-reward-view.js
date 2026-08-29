const REWARD_DOM = Object.freeze({
  gameOrChance: {
    title: 'twitchGameOrChanceTitle',
    cost: 'twitchGameOrChanceCost',
    max: 'twitchGameOrChanceMax',
    action: 'twitchGameOrChanceAction',
    status: 'twitchGameOrChanceStatus'
  },
  chanceOnly: {
    title: 'twitchChanceOnlyTitle',
    cost: 'twitchChanceOnlyCost',
    max: 'twitchChanceOnlyMax',
    action: 'twitchChanceOnlyAction',
    status: 'twitchChanceOnlyStatus'
  }
});

export function createTwitchRewardView(root, {
  onCreate = () => {},
  onDelete = () => {}
} = {}) {
  const get = id => root.getElementById?.(id) ?? root.querySelector?.(`#${id}`);
  const confirmAction = message => (root.defaultView?.confirm ?? globalThis.confirm)(message);

  function showStatus(type, status = {}) {
    const element = get(REWARD_DOM[type].status);
    if (!element) return;
    element.textContent = status.message ?? '';
    element.className = `twitch-reward-status ${status.state ?? ''}`.trim();
  }

  function readConfig(type) {
    const ids = REWARD_DOM[type];
    const title = get(ids.title).value.trim();
    const cost = Number(get(ids.cost).value);
    const maxRaw = get(ids.max).value.trim();
    const maxPerUserPerStream = maxRaw === '' ? null : Number(maxRaw);
    if (!title || title.length > 45) {
      throw new TypeError('Назва нагороди має містити від 1 до 45 символів.');
    }
    if (!Number.isInteger(cost) || cost < 1) {
      throw new TypeError('Бали мають бути цілим числом від 1.');
    }
    if (maxPerUserPerStream !== null && (
      !Number.isInteger(maxPerUserPerStream) || maxPerUserPerStream < 1
    )) {
      throw new TypeError('Ліміт має бути цілим числом від 1 або порожнім.');
    }
    return { title, cost, maxPerUserPerStream };
  }

  async function handleRewardAction(button) {
    const card = button.closest('[data-reward-type]');
    const type = card?.dataset.rewardType;
    if (!REWARD_DOM[type]) return;
    if (button.dataset.rewardId) {
      const title = get(REWARD_DOM[type].title).value;
      if (confirmAction(`Видалити нагороду «${title}» з Twitch?`)) {
        await onDelete(type, button.dataset.rewardId);
      }
      return;
    }
    try {
      await onCreate(type, readConfig(type));
    } catch (error) {
      showStatus(type, { state: 'error', message: error.message });
    }
  }

  function handleClick(event) {
    const button = event.target.closest?.('button');
    if (!button) return;
    if (button.classList.contains('twitch-reward-action')) void handleRewardAction(button);
  }

  root.addEventListener('click', handleClick);

  return {
    render({ user = null, rewards = {}, statuses = {}, connectionStatus = {} } = {}) {
      const panel = get('twitchPanel');
      const loggedOut = get('twitchLoggedOut');
      const loggedIn = get('twitchLoggedIn');
      if (panel && user && 'open' in panel) panel.open = true;
      if (loggedOut) loggedOut.style.display = user ? 'none' : '';
      if (loggedIn) loggedIn.style.display = user ? '' : 'none';
      if (user && get('twitchUserName')) get('twitchUserName').textContent = user.login;

      for (const [type, ids] of Object.entries(REWARD_DOM)) {
        const config = rewards[type];
        if (!config) continue;
        const isCreated = Boolean(config.rewardId);
        get(ids.title).value = config.title;
        get(ids.cost).value = String(config.cost);
        get(ids.max).value = config.maxPerUserPerStream === null
          ? ''
          : String(config.maxPerUserPerStream);
        for (const id of [ids.title, ids.cost, ids.max]) get(id).readOnly = isCreated;
        const action = get(ids.action);
        action.textContent = isCreated ? 'Видалити нагороду' : 'Додати нагороду';
        if (isCreated) action.dataset.rewardId = config.rewardId;
        else delete action.dataset.rewardId;
        showStatus(type, statuses[type]);
      }

      const connection = get('twitchEventStatus');
      if (connection) {
        connection.textContent = `● ${connectionStatus.message ?? 'Прослуховування вимкнено'}`;
        connection.className = `twitch-event-status ${connectionStatus.state ?? 'muted'}`;
      }
    },
    destroy() {
      root.removeEventListener('click', handleClick);
    }
  };
}
