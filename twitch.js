// twitch.js — інтеграція з Twitch (сторінка index.html).
//
// Що робить:
//  1. Логін через Twitch (OAuth, implicit flow) — кнопка "Увійти через Twitch".
//  2. Створення на каналі користувача нагороди за бали каналу "рандом ігор"
//     з обов'язковим текстовим полем від глядача.
//  3. Підключення до Twitch EventSub через WebSocket і "прослуховування"
//     використань цієї нагороди — введений глядачем текст автоматично
//     додається як варіант гри у список (через build.js).
//
// !!! ПЕРЕД ВИКОРИСТАННЯМ ТРЕБА НАЛАШТУВАТИ:
//  1. Зареєструвати застосунок на https://dev.twitch.tv/console/apps
//     (безкоштовно, кнопка "Register Your Application").
//  2. В полі "OAuth Redirect URLs" вписати ТОЧНУ адресу, за якою у вас
//     відкривається index.html, наприклад:
//       https://мій-сайт.com/index.html
//     або для локальної розробки:
//       http://localhost:5500/index.html
//     Twitch НЕ дозволяє редірект на file:// — сайт має бути доступний
//     по http(s), навіть локально (напр. через VSCode "Live Server").
//  3. Скопіювати виданий "Client ID" і вписати його нижче в CLIENT_ID.
//  4. Категорія застосунку — будь-яка, тип — "Confidential" не потрібен,
//     обирайте "Public" (Client Secret тут не використовується взагалі —
//     все відбувається в браузері глядача-стрімера, токен нікуди не шлється
//     окрім самого Twitch).
(function (global) {
  "use strict";

  // ==================== НАЛАШТУВАННЯ ====================
  const CLIENT_ID = '2xy2z7so34qc9k5i7kvf1e16upnusz';
  // Для вашого сайту (oldwizy.github.io/Game-Wheel) це автоматично буде:
  //   https://oldwizy.github.io/Game-Wheel/index.html
  // Саме цю адресу і вписуйте в "OAuth Redirect URLs" на dev.twitch.tv/console/apps.
  // За замовчуванням редірект веде назад на index.html у тій самій папці,
  // де зараз відкритий сайт. Можна прописати вручну, якщо потрібно інше.
  const REDIRECT_URI = window.location.origin + window.location.pathname.replace(/[^/]*$/, 'index.html');
  const SCOPES = ['channel:manage:redemptions', 'channel:read:redemptions'];
  const REWARD_TITLE = 'рандом ігор';
  const REWARD_PROMPT = 'Впишіть назву гри — вона автоматично потрапить у список розіграшу';
  // ========================================================

  const TOKEN_KEY = 'twitch_token_v1';

  const $ = (sel) => document.querySelector(sel);

  let eventSocket = null;
  let reconnectTimer = null;

  // ---- Зберігання токена ----
  function saveToken(token) {
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, savedAt: Date.now() })); }
    catch (e) { /* ignore */ }
  }
  function loadToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.token ? parsed.token : null;
    } catch (e) { return null; }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  // ---- Крок 1: логін ----
  function login() {
    if (CLIENT_ID === 'ВСТАВТЕ_СЮДИ_ВАШ_TWITCH_CLIENT_ID') {
      alert('Спочатку потрібно вписати ваш Twitch Client ID у файл twitch.js (константа CLIENT_ID). Дивіться коментар на початку файлу.');
      return;
    }
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'token',
      scope: SCOPES.join(' '),
      force_verify: 'true'
    });
    window.location.href = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  function logout() {
    disconnectEventSub();
    clearToken();
    renderStatus(null);
  }

  // Забирає access_token з хеша адресного рядка після редіректу від Twitch.
  function grabTokenFromUrl() {
    if (!window.location.hash || window.location.hash.indexOf('access_token') === -1) return null;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('access_token');
    // Прибираємо токен з адресного рядка, щоб він не "світився" в історії браузера.
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return token;
  }

  // ---- Допоміжні виклики Twitch API ----
  async function validateToken(token) {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token}` }
    });
    if (!res.ok) return null;
    return res.json(); // { client_id, login, user_id, scopes, expires_in }
  }

  async function helix(path, token, options = {}) {
    const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
      ...options,
      headers: {
        'Client-Id': CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Twitch API error (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---- Крок 2: створення нагороди ----
  async function findExistingReward(token, broadcasterId) {
    try {
      const data = await helix(`channel_points/custom_rewards?broadcaster_id=${broadcasterId}`, token);
      return (data.data || []).find(r => r.title === REWARD_TITLE) || null;
    } catch (e) {
      return null; // якщо немає своїх нагород або немає прав переглянути чужі — ігноруємо
    }
  }

  async function createReward(token, broadcasterId, cost) {
    const existing = await findExistingReward(token, broadcasterId);
    if (existing) return { reward: existing, created: false };

    const data = await helix(`channel_points/custom_rewards?broadcaster_id=${broadcasterId}`, token, {
      method: 'POST',
      body: JSON.stringify({
        title: REWARD_TITLE,
        prompt: REWARD_PROMPT,
        cost: cost,
        is_user_input_required: true,
        is_enabled: true
      })
    });
    return { reward: data.data[0], created: true };
  }

  // ---- Крок 3: EventSub — слухаємо активації нагороди ----
  function disconnectEventSub() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (eventSocket) {
      try { eventSocket.onclose = null; eventSocket.close(); } catch (e) { /* ignore */ }
      eventSocket = null;
    }
    setEventSubStatus('off');
  }

  function connectEventSub(token, broadcasterId, wsUrl) {
    disconnectEventSub();
    setEventSubStatus('connecting');
    const socket = new WebSocket(wsUrl || 'wss://eventsub.wss.twitch.tv/ws');
    eventSocket = socket;

    socket.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch (e) { return; }
      const type = data.metadata && data.metadata.message_type;

      if (type === 'session_welcome') {
        const sessionId = data.payload.session.id;
        subscribeToRedemptions(token, broadcasterId, sessionId)
          .then(() => setEventSubStatus('on'))
          .catch((e) => {
            console.error('Не вдалось підписатись на нагороди:', e);
            setEventSubStatus('error', e.message);
          });
      } else if (type === 'session_reconnect') {
        const newUrl = data.payload.session.reconnect_url;
        connectEventSub(token, broadcasterId, newUrl);
      } else if (type === 'notification') {
        const subType = data.metadata.subscription_type;
        if (subType === 'channel.channel_points_custom_reward_redemption.add') {
          handleRedemption(data.payload.event, token, broadcasterId);
        }
      }
      // session_keepalive — нічого робити не треба, це просто "пінг".
    };

    socket.onclose = () => {
      if (eventSocket !== socket) return; // це вже старий сокет, ігноруємо
      setEventSubStatus('off');
      // Автоперепідключення через кілька секунд, якщо користувач ще на сторінці.
      reconnectTimer = setTimeout(() => {
        const token = loadToken();
        if (token && global.TwitchIntegration.currentBroadcasterId) {
          connectEventSub(token, global.TwitchIntegration.currentBroadcasterId);
        }
      }, 5000);
    };

    socket.onerror = () => setEventSubStatus('error');
  }

  async function subscribeToRedemptions(token, broadcasterId, sessionId) {
    await helix('eventsub/subscriptions', token, {
      method: 'POST',
      body: JSON.stringify({
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: broadcasterId },
        transport: { method: 'websocket', session_id: sessionId }
      })
    });
  }

  function handleRedemption(event, token, broadcasterId) {
    // event.reward.title / event.user_input / event.user_name / event.id
    if (event.reward.title !== REWARD_TITLE) return;
    const text = (event.user_input || '').trim();
    if (!text) return;

    logRedemption(event.user_name, text);

    // Додаємо гру в список поточної сторінки (функція з build.js).
    if (global.BuildPage && typeof global.BuildPage.addExternalGame === 'function') {
      global.BuildPage.addExternalGame(text, event.user_name);
    }

    // Автоматично позначаємо винагороду як виконану, щоб бали не "висіли"
    // в черзі модерації стрімера. Якщо це не потрібно — просто видаліть блок нижче.
    helix(
      `channel_points/custom_rewards/redemptions?broadcaster_id=${broadcasterId}&reward_id=${event.reward.id}&id=${event.id}`,
      token,
      { method: 'PATCH', body: JSON.stringify({ status: 'FULFILLED' }) }
    ).catch((e) => console.warn('Не вдалось позначити нагороду виконаною:', e));
  }

  // ==================== UI ====================
  function setEventSubStatus(status, detail) {
    const el = $('#twitchEventStatus');
    if (!el) return;
    const map = {
      off: ['●', 'Прослуховування вимкнене', 'muted'],
      connecting: ['●', 'Підключення…', 'pending'],
      on: ['●', 'Слухаємо активації нагороди наживо', 'live'],
      error: ['●', 'Помилка підключення' + (detail ? ': ' + detail : ''), 'error']
    };
    const [dot, text, cls] = map[status] || map.off;
    el.textContent = `${dot} ${text}`;
    el.className = 'twitch-event-status ' + cls;
  }

  function logRedemption(userName, text) {
    const list = $('#twitchRedemptionLog');
    if (!list) return;
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.innerHTML = `<span class="tr-time">${time}</span><span class="tr-user">${Common.escapeHtml(userName)}</span><span class="tr-text">→ ${Common.escapeHtml(text)}</span>`;
    list.prepend(li);
    while (list.children.length > 20) list.removeChild(list.lastChild);
  }

  function renderStatus(userInfo) {
    const loggedOutBlock = $('#twitchLoggedOut');
    const loggedInBlock = $('#twitchLoggedIn');
    if (!loggedOutBlock || !loggedInBlock) return;

    if (!userInfo) {
      loggedOutBlock.style.display = '';
      loggedInBlock.style.display = 'none';
      return;
    }
    loggedOutBlock.style.display = 'none';
    loggedInBlock.style.display = '';
    const nameEl = $('#twitchUserName');
    if (nameEl) nameEl.textContent = userInfo.login;
  }

  function setRewardStatus(text, cls) {
    const el = $('#twitchRewardStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'twitch-reward-status ' + (cls || '');
  }

  // ---- Ініціалізація при завантаженні сторінки ----
  async function init() {
    const loginBtn = $('#twitchLoginBtn');
    const logoutBtn = $('#twitchLogoutBtn');
    const createRewardBtn = $('#twitchCreateRewardBtn');
    const costInput = $('#twitchCostInput');

    if (loginBtn) loginBtn.addEventListener('click', login);
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    if (createRewardBtn) {
      createRewardBtn.addEventListener('click', async () => {
        const token = loadToken();
        if (!token || !global.TwitchIntegration.currentBroadcasterId) return;
        createRewardBtn.disabled = true;
        setRewardStatus('Створюємо нагороду…', 'pending');
        try {
          const cost = Math.max(1, parseInt(costInput && costInput.value, 10) || 100);
          const { reward, created } = await createReward(token, global.TwitchIntegration.currentBroadcasterId, cost);
          setRewardStatus(
            created
              ? `Готово! Нагороду «${REWARD_TITLE}» створено на каналі.`
              : `Нагорода «${REWARD_TITLE}» вже існує на каналі — використовуємо її.`,
            'ok'
          );
          connectEventSub(token, global.TwitchIntegration.currentBroadcasterId);
        } catch (e) {
          console.error(e);
          setRewardStatus('Не вдалось створити нагороду: ' + e.message, 'error');
        } finally {
          createRewardBtn.disabled = false;
        }
      });
    }

    // Якщо щойно повернулись від Twitch з токеном у URL — зберігаємо його.
    const freshToken = grabTokenFromUrl();
    if (freshToken) saveToken(freshToken);

    const token = loadToken();
    if (!token) { renderStatus(null); return; }

    const info = await validateToken(token);
    if (!info) { clearToken(); renderStatus(null); return; }

    global.TwitchIntegration.currentBroadcasterId = info.user_id;
    renderStatus(info);

    // Якщо нагорода вже існує на каналі — одразу починаємо слухати редемпшени.
    const existing = await findExistingReward(token, info.user_id);
    if (existing) {
      setRewardStatus(`Нагорода «${REWARD_TITLE}» вже налаштована на каналі.`, 'ok');
      connectEventSub(token, info.user_id);
    } else {
      setRewardStatus('Нагороду ще не створено на каналі.', '');
    }
  }

  global.TwitchIntegration = {
    login, logout, currentBroadcasterId: null
  };

  document.addEventListener('DOMContentLoaded', init);
})(window);
