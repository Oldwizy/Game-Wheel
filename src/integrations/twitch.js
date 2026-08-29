import { REWARD_TYPES } from './twitch-queue-state.js';

const CLIENT_ID = '2xy2z7so34qc9k5i7kvf1e16upnusz';
const TOKEN_KEY = 'twitch_token_v1';
const OAUTH_STATE_KEY = 'twitch_oauth_state_v1';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const REWARD_PROMPT = 'Введи назву гри';
const REWARD_TYPE_VALUES = new Set(Object.values(REWARD_TYPES));
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const REDEMPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';
const REDEMPTION_LOOKBACK_MS = 12 * 60 * 60 * 1000;

export function createTwitchIntegration(optionsOrRoot = {}, legacyOptions) {
  const root = legacyOptions ? optionsOrRoot : null;
  const {
    fetch: fetchFn = globalThis.fetch,
    WebSocketClass = globalThis.WebSocket,
    location: loc = globalThis.location ?? {},
    history: browserHistory = globalThis.history ?? {},
    storage = globalThis.localStorage,
    sessionStorage: session = globalThis.sessionStorage,
    onRedemption = () => {},
    onStatus = () => {},
    now = () => new Date(),
    crypto: cryptoApi = globalThis.crypto,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout
  } = legacyOptions ?? optionsOrRoot;

  let accessToken = null;
  let broadcasterId = null;
  let user = null;
  let configuredSlots = {};
  let socket = null;
  let destroyed = false;
  let reconnectTimer = null;

  const get = id => root?.getElementById?.(id) ?? root?.querySelector?.(`#${id}`);

  function saveToken(token) {
    try {
      session?.setItem(TOKEN_KEY, JSON.stringify({ token, savedAt: Date.now() }));
    } catch {}
  }

  function loadToken() {
    try {
      return JSON.parse(session?.getItem(TOKEN_KEY))?.token ?? null;
    } catch {
      return null;
    }
  }

  function clearToken() {
    try {
      session?.removeItem(TOKEN_KEY);
    } catch {}
  }

  function clearLegacyToken() {
    try {
      storage?.removeItem(TOKEN_KEY);
    } catch {}
  }

  function saveOAuthState(value) {
    try {
      storage?.setItem(OAUTH_STATE_KEY, JSON.stringify({ value, createdAt: Date.now() }));
    } catch {}
  }

  function takeOAuthState() {
    try {
      const value = JSON.parse(storage?.getItem(OAUTH_STATE_KEY));
      storage?.removeItem(OAUTH_STATE_KEY);
      return value;
    } catch {
      return null;
    }
  }

  function createOAuthState() {
    if (typeof cryptoApi?.getRandomValues !== 'function') {
      throw new Error('Браузер не підтримує безпечну Twitch-авторизацію.');
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function isValidOAuthState(saved, received) {
    return typeof saved?.value === 'string'
      && typeof received === 'string'
      && saved.value === received
      && Number.isFinite(saved.createdAt)
      && Date.now() - saved.createdAt >= 0
      && Date.now() - saved.createdAt <= OAUTH_STATE_TTL_MS;
  }

  function render(userInfo) {
    const panel = get('twitchPanel');
    const loggedOut = get('twitchLoggedOut');
    const loggedIn = get('twitchLoggedIn');
    if (panel) panel.open = Boolean(userInfo);
    if (loggedOut) loggedOut.style.display = userInfo ? 'none' : '';
    if (loggedIn) loggedIn.style.display = userInfo ? '' : 'none';
    const userName = get('twitchUserName');
    if (userInfo && userName) userName.textContent = userInfo.login;
  }

  async function api(path, options = {}) {
    const response = await fetchFn(`https://api.twitch.tv/helix/${path}`, {
      ...options,
      headers: {
        'Client-Id': CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || `Twitch API error (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function validateRewardConfig(type, config) {
    if (!REWARD_TYPE_VALUES.has(type)) throw new TypeError('Невідомий тип нагороди.');
    const title = typeof config?.title === 'string' ? config.title.trim() : '';
    if (!title) throw new TypeError('Вкажи назву нагороди.');
    if (title.length > 45) throw new TypeError('Назва нагороди має містити не більше 45 символів.');
    if (!Number.isInteger(config.cost) || config.cost < 1) {
      throw new TypeError('Кількість балів має бути цілим числом від 1.');
    }
    if (config.maxPerUserPerStream !== null && (
      !Number.isInteger(config.maxPerUserPerStream) || config.maxPerUserPerStream < 1
    )) {
      throw new TypeError('Вкажи ліміт використань цілим числом від 1 або залиш поле порожнім.');
    }
    return {
      title,
      cost: config.cost,
      maxPerUserPerStream: config.maxPerUserPerStream
    };
  }

  async function init(rewardSlots = {}) {
    const freshToken = new URLSearchParams(loc.hash?.slice(1)).get('access_token');
    const returnedState = new URLSearchParams(loc.hash?.slice(1)).get('state');
    let oauthError = null;
    if (freshToken) {
      const savedState = takeOAuthState();
      browserHistory.replaceState?.(null, '', `${loc.pathname ?? ''}${loc.search ?? ''}`);
      if (isValidOAuthState(savedState, returnedState)) {
        saveToken(freshToken);
      } else {
        oauthError = new Error('Не вдалося перевірити Twitch-авторизацію. Спробуй увійти ще раз.');
      }
    }

    accessToken = loadToken();
    if (!accessToken) {
      render(null);
      return { user: null, verifiedSlots: rewardSlots, reconciledRedemptions: [], unfulfilledRedemptionIds: [], oauthError };
    }

    const validation = await fetchFn('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${accessToken}` }
    });
    if (!validation.ok) {
      clearToken();
      accessToken = null;
      render(null);
      return { user: null, verifiedSlots: rewardSlots, reconciledRedemptions: [], unfulfilledRedemptionIds: [], oauthError };
    }

    user = await validation.json();
    broadcasterId = user.user_id;
    render(user);
    configuredSlots = rewardSlots;
    try {
      const rewardData = await api(
        `channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}`
      );
      const existingIds = new Set((rewardData.data ?? []).map(reward => reward.id));
      configuredSlots = Object.fromEntries(Object.entries(rewardSlots).map(([type, config]) => [
        type,
        {
          ...config,
          rewardId: config.rewardId && existingIds.has(config.rewardId) ? config.rewardId : null
        }
      ]));
    } catch (error) {
      // A temporary Helix failure must not sign the streamer out: the OAuth
      // token was already validated and the next refresh can retry this call.
      reportConnection('error', `Не вдалося завантажити Twitch-нагороди: ${error.message}`);
    }
    let reconciliation;
    try {
      reconciliation = await reconcileRedemptions();
    } catch (error) {
      reportConnection(
        'error',
        `Не вдалося відновити пропущені Twitch-заявки: ${error.message}`
      );
      reconciliation = { reconciledRedemptions: [], unfulfilledRedemptionIds: null };
    }
    return {
      user,
      verifiedSlots: configuredSlots,
      oauthError,
      ...reconciliation
    };
  }

  async function createReward(type, config) {
    const validated = validateRewardConfig(type, config);
    if (!accessToken || !broadcasterId) throw new Error('Спочатку увійди через Twitch.');
    const body = {
      title: validated.title,
      prompt: REWARD_PROMPT,
      cost: validated.cost,
      is_user_input_required: true,
      should_redemptions_skip_request_queue: false,
      is_max_per_user_per_stream_enabled: validated.maxPerUserPerStream !== null
    };
    if (validated.maxPerUserPerStream !== null) {
      body.max_per_user_per_stream = validated.maxPerUserPerStream;
    }

    const data = await api(
      `channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    return data.data?.[0] ?? null;
  }

  async function deleteReward(type, rewardId) {
    if (!REWARD_TYPE_VALUES.has(type)) throw new TypeError('Невідомий тип нагороди.');
    if (!rewardId || configuredSlots[type]?.rewardId !== rewardId) {
      throw new Error('Ця нагорода не належить поточному налаштуванню.');
    }
    await api(
      `channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(rewardId)}`,
      { method: 'DELETE' }
    );
    configuredSlots = {
      ...configuredSlots,
      [type]: { ...configuredSlots[type], rewardId: null }
    };
    return configuredSlots[type];
  }

  function disconnect() {
    if (reconnectTimer !== null) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
    }
    if (!socket) return;
    const previous = socket;
    socket = null;
    previous.onmessage = null;
    previous.onerror = null;
    previous.onclose = null;
    previous.close();
  }

  function reportConnection(state, message) {
    onStatus({ scope: 'connection', type: null, state, message });
  }

  function configuredRewardType(rewardId) {
    return Object.entries(configuredSlots)
      .find(([, config]) => config.rewardId === rewardId)?.[0] ?? null;
  }

  function normalizeRedemption(event) {
    const rewardType = configuredRewardType(event.reward?.id);
    const input = String(event.user_input ?? '').trim().replace(/\s+/g, ' ');
    if (!rewardType || !input) return null;
    const received = now();
    const receivedAt = received instanceof Date ? received : new Date(received);
    return {
      id: event.id,
      rewardType,
      rewardId: event.reward.id,
      rewardTitle: event.reward.title || configuredSlots[rewardType].title,
      viewerId: event.user_id,
      viewerName: event.user_name || event.user_login,
      input,
      redeemedAt: event.redeemed_at,
      receivedAt: receivedAt.toISOString()
    };
  }

  async function reconcileRedemptions() {
    const byId = new Map();
    const cutoff = new Date(now()).getTime() - REDEMPTION_LOOKBACK_MS;
    for (const config of Object.values(configuredSlots)) {
      if (!config.rewardId) continue;
      let cursor = null;
      let reachedCutoff = false;
      do {
        const query = new URLSearchParams({
          broadcaster_id: broadcasterId,
          reward_id: config.rewardId,
          status: 'UNFULFILLED',
          sort: 'NEWEST',
          first: '50'
        });
        if (cursor) query.set('after', cursor);
        const page = await api(`channel_points/custom_rewards/redemptions?${query}`);
        for (const redemption of page.data ?? []) {
          const redeemedAt = Date.parse(redemption.redeemed_at);
          if (Number.isNaN(redeemedAt)) continue;
          if (redeemedAt < cutoff) {
            reachedCutoff = true;
            continue;
          }
          if (!byId.has(redemption.id)) byId.set(redemption.id, redemption);
        }
        cursor = reachedCutoff ? null : page.pagination?.cursor ?? null;
      } while (cursor);
    }
    const ordered = [...byId.values()].sort((left, right) => (
      Date.parse(left.redeemed_at) - Date.parse(right.redeemed_at)
      || left.id.localeCompare(right.id)
    ));
    return {
      reconciledRedemptions: ordered.map(normalizeRedemption).filter(Boolean),
      unfulfilledRedemptionIds: ordered.map(redemption => redemption.id)
    };
  }

  async function refreshRedemptions() {
    if (!accessToken || !broadcasterId) throw new Error('Спочатку увійди через Twitch.');
    try {
      return await reconcileRedemptions();
    } finally {
      syncRewards(configuredSlots);
    }
  }

  async function subscribe(sessionId) {
    for (const config of Object.values(configuredSlots)) {
      if (!config.rewardId) continue;
      await api('eventsub/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          type: REDEMPTION_TYPE,
          version: '1',
          condition: {
            broadcaster_user_id: broadcasterId,
            reward_id: config.rewardId
          },
          transport: { method: 'websocket', session_id: sessionId }
        })
      });
    }
  }

  function connect(url = EVENTSUB_URL) {
    disconnect();
    destroyed = false;
    reportConnection('pending', 'Підключаємо Twitch-заявки…');
    const current = new WebSocketClass(url);
    socket = current;
    current.onmessage = async message => {
      let data;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      const messageType = data.metadata?.message_type;
      if (messageType === 'session_welcome') {
        try {
          await subscribe(data.payload.session.id);
          if (socket !== current || destroyed) return;
          reportConnection('live', 'Twitch-заявки слухаємо наживо.');
        } catch (error) {
          if (socket !== current || destroyed) return;
          reportConnection('error', `Не вдалося підписатися на Twitch-заявки: ${error.message}`);
        }
        return;
      }
      if (messageType === 'session_reconnect') {
        connect(data.payload.session.reconnect_url);
        return;
      }
      if (
        messageType === 'notification'
        && data.metadata?.subscription_type === REDEMPTION_TYPE
      ) {
        const redemption = normalizeRedemption(data.payload.event);
        if (redemption) onRedemption(redemption);
      }
    };
    current.onerror = () => reportConnection('error', 'Зв’язок із Twitch загубився.');
    current.onclose = () => {
      if (socket !== current || destroyed) return;
      socket = null;
      reportConnection('idle', 'Зв’язок із Twitch перервався. Перепідключаємося…');
      reconnectTimer = setTimer(() => {
        reconnectTimer = null;
        if (!destroyed && accessToken && broadcasterId) connect();
      }, 5000);
    };
  }

  function syncRewards(rewardSlots) {
    configuredSlots = Object.fromEntries(
      Object.entries(rewardSlots).map(([type, config]) => [type, { ...config }])
    );
    const hasRewards = Object.values(configuredSlots).some(config => config.rewardId);
    if (!accessToken || !broadcasterId || !hasRewards) {
      disconnect();
      reportConnection('idle', 'Прослуховування вимкнено.');
      return;
    }
    connect();
  }

  function login() {
    const redirectUri = `${loc.origin ?? ''}${String(loc.pathname ?? '').replace(/[^/]*$/, 'index.html')}`;
    const state = createOAuthState();
    saveOAuthState(state);
    loc.href = `https://id.twitch.tv/oauth2/authorize?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'token',
      state,
      scope: 'channel:manage:redemptions channel:read:redemptions',
      state,
      force_verify: 'true'
    })}`;
  }

  function logout() {
    try {
      disconnect();
    } catch {}
    configuredSlots = {};
    clearToken();
    clearLegacyToken();
    clearOAuthState();
    accessToken = null;
    broadcasterId = null;
    user = null;
    try {
      disconnect();
    } catch {}
    render(null);
  }

  return {
    init,
    createReward,
    deleteReward,
    refreshRedemptions,
    syncRewards,
    login,
    logout,
    destroy() {
      destroyed = true;
      disconnect();
    }
  };
}
