import { describe, expect, test, vi } from 'vitest';
import { createDefaultTwitchState, REWARD_TYPES } from '../../src/integrations/twitch-queue-state.js';
import { createTwitchIntegration } from '../../src/integrations/twitch.js';

function storage(token = 'token') {
  const values = new Map(token ? [['twitch_token_v1', JSON.stringify({ token })]] : []);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: vi.fn(key => values.delete(key))
  };
}

function response(data = {}, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

class FakeSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  close = vi.fn();

  emit(payload) {
    return this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function apiFetch({ rewards = [] } = {}) {
  return vi.fn(async (url, options = {}) => {
    const method = options.method ?? 'GET';
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      return response({
        client_id: 'client',
        login: 'streamer',
        user_id: 'broadcaster',
        scopes: ['channel:manage:redemptions'],
        expires_in: 3600
      });
    }
    if (url.includes('/helix/channel_points/custom_rewards?') && method === 'GET') {
      return response({ data: rewards });
    }
    if (url.includes('/redemptions?') && method === 'GET') {
      return response({ data: [], pagination: {} });
    }
    if (url.includes('/helix/eventsub/subscriptions') && method === 'POST') {
      return response({ data: [{ id: 'subscription' }] });
    }
    if (url.includes('/helix/channel_points/custom_rewards?') && method === 'POST') {
      const body = JSON.parse(options.body);
      return response({ data: [{ id: 'created-reward', ...body }] });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

function integration(fetch, overrides = {}) {
  return createTwitchIntegration({
    fetch,
    WebSocketClass: FakeSocket,
    sessionStorage: storage(),
    location: { hash: '', origin: 'https://example.test', pathname: '/index.html', search: '' },
    history: { replaceState: vi.fn() },
    ...overrides
  });
}

describe('Twitch authorization redirect', () => {
  test('returns to the home screen after authorization with a CSRF state', () => {
    const location = { hash: '', origin: 'https://example.test', pathname: '/', search: '' };
    const sessionStorage = storage(null);
    const twitch = integration(apiFetch(), { location, sessionStorage });

    twitch.login();

    const authorizationUrl = new URL(location.href);
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe('https://example.test/index.html');
    expect(authorizationUrl.searchParams.get('state')).toBeTruthy();
    expect(sessionStorage.getItem('twitch_oauth_state_v1')).toBe(authorizationUrl.searchParams.get('state'));
  });

  test('ignores an OAuth callback with an unexpected state', async () => {
    const sessionStorage = storage(null);
    sessionStorage.setItem('twitch_oauth_state_v1', 'expected-state');
    const location = {
      hash: '#access_token=attacker-token&state=unexpected-state',
      origin: 'https://example.test', pathname: '/index.html', search: ''
    };
    const fetch = apiFetch();
    const twitch = integration(fetch, { location, sessionStorage });

    const result = await twitch.init(createDefaultTwitchState().rewards);

    expect(result.user).toBeNull();
    expect(sessionStorage.getItem('twitch_token_v1')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

test('keeps a validated session when loading rewards temporarily fails', async () => {
  const savedStorage = storage();
  const fetch = vi.fn(async url => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      return response({ login: 'streamer', user_id: 'broadcaster' });
    }
    return response({ message: 'Temporary outage' }, { ok: false, status: 503 });
  });
  const twitch = createTwitchIntegration({
    fetch,
    WebSocketClass: FakeSocket,
    sessionStorage: savedStorage,
    location: { hash: '', origin: 'https://example.test', pathname: '/index.html', search: '' },
    history: { replaceState: vi.fn() }
  });

  const result = await twitch.init(createDefaultTwitchState().rewards);

  expect(result.user).toMatchObject({ login: 'streamer', user_id: 'broadcaster' });
  expect(savedStorage.removeItem).not.toHaveBeenCalled();
});

describe('Twitch reward creation', () => {
  test.each([
    [
      REWARD_TYPES.GAME_OR_CHANCE,
      { title: 'Додати гру або копію', cost: 100, maxPerUserPerStream: null },
      {
        title: 'Додати гру або копію',
        prompt: 'Введи назву гри',
        cost: 100,
        is_user_input_required: true,
        should_redemptions_skip_request_queue: false,
        is_max_per_user_per_stream_enabled: false
      }
    ],
    [
      REWARD_TYPES.CHANCE_ONLY,
      { title: 'Додати тільки копію', cost: 250, maxPerUserPerStream: 12 },
      {
        title: 'Додати тільки копію',
        prompt: 'Введи назву гри',
        cost: 250,
        is_user_input_required: true,
        should_redemptions_skip_request_queue: false,
        is_max_per_user_per_stream_enabled: true,
        max_per_user_per_stream: 12
      }
    ]
  ])('creates %s with its exact Twitch payload', async (type, config, expectedBody) => {
    const fetch = apiFetch();
    const twitch = integration(fetch);
    await twitch.init(createDefaultTwitchState().rewards);

    const reward = await twitch.createReward(type, config);

    const creation = fetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(creation[1].body)).toEqual(expectedBody);
    expect(reward).toMatchObject({ id: 'created-reward', ...expectedBody });
  });

  test.each([
    [{ title: '', cost: 100, maxPerUserPerStream: null }, 'назв'],
    [{ title: 'x'.repeat(46), cost: 100, maxPerUserPerStream: null }, '45'],
    [{ title: 'Reward', cost: 0, maxPerUserPerStream: null }, 'бал'],
    [{ title: 'Reward', cost: 100, maxPerUserPerStream: 0 }, 'ліміт']
  ])('rejects invalid config before a Twitch request', async (config, message) => {
    const fetch = apiFetch();
    const twitch = integration(fetch);
    await twitch.init(createDefaultTwitchState().rewards);
    const callsBefore = fetch.mock.calls.length;

    await expect(twitch.createReward(REWARD_TYPES.GAME_OR_CHANCE, config)).rejects.toThrow(message);

    expect(fetch).toHaveBeenCalledTimes(callsBefore);
  });
});

describe('Twitch authorization lifecycle', () => {
  test('requires the OAuth state returned by Twitch before saving a token', async () => {
    const saved = storage(null);
    const location = {
      hash: '', origin: 'https://example.test', pathname: '/index.html', search: '', href: ''
    };
    const twitch = createTwitchIntegration({
      fetch: apiFetch(),
      storage: saved,
      location,
      history: { replaceState: vi.fn() },
      crypto: { getRandomValues: bytes => bytes.fill(7) }
    });

    twitch.login();
    const state = new URL(location.href).searchParams.get('state');
    expect(state).toHaveLength(64);
    expect(JSON.parse(saved.getItem('twitch_oauth_state_v1')).value).toBe(state);

    location.hash = `#access_token=untrusted-token&state=${state}`;
    await twitch.init(createDefaultTwitchState().rewards);
    expect(JSON.parse(saved.getItem('twitch_token_v1')).token).toBe('untrusted-token');

    saved.removeItem('twitch_token_v1');
    location.hash = '#access_token=another-token&state=invalid';
    const result = await twitch.init(createDefaultTwitchState().rewards);
    expect(saved.getItem('twitch_token_v1')).toBeNull();
    expect(result.oauthError).toBeInstanceOf(Error);
  });

  test('closes the EventSub socket on logout', async () => {
    FakeSocket.instances.length = 0;
    const fetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Game reward' }] });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch);
    const { verifiedSlots } = await twitch.init(slots);
    twitch.syncRewards(verifiedSlots);

    const socket = FakeSocket.instances[0];
    twitch.logout();

    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.onmessage).toBeNull();
  });
});

describe('Twitch reward ownership', () => {
  test('keeps only configured reward IDs that still exist on the channel', async () => {
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'owned-game';
    slots[REWARD_TYPES.CHANCE_ONLY].rewardId = 'missing-chance';
    const fetch = apiFetch({
      rewards: [
        { id: 'owned-game', title: 'Renamed by streamer' },
        { id: 'somebody-elses', title: slots[REWARD_TYPES.CHANCE_ONLY].title }
      ]
    });
    const twitch = integration(fetch);

    const result = await twitch.init(slots);

    expect(result.verifiedSlots).toEqual({
      [REWARD_TYPES.GAME_OR_CHANCE]: { ...slots[REWARD_TYPES.GAME_OR_CHANCE] },
      [REWARD_TYPES.CHANCE_ONLY]: { ...slots[REWARD_TYPES.CHANCE_ONLY], rewardId: null }
    });
  });

  test('deletes the exact configured reward and returns the cleared slot', async () => {
    const fetch = apiFetch({ rewards: [{ id: 'owned-game', title: 'Reward' }] });
    fetch.mockImplementationOnce(fetch.getMockImplementation());
    const original = fetch.getMockImplementation();
    fetch.mockImplementation(async (url, options = {}) => {
      if ((options.method ?? 'GET') === 'DELETE') return response({}, { status: 204 });
      return original(url, options);
    });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'owned-game';
    const twitch = integration(fetch);
    await twitch.init(slots);

    const cleared = await twitch.deleteReward(REWARD_TYPES.GAME_OR_CHANCE, 'owned-game');

    const deletion = fetch.mock.calls.find(([, options]) => options?.method === 'DELETE');
    expect(deletion[0]).toContain('broadcaster_id=broadcaster');
    expect(deletion[0]).toContain('id=owned-game');
    expect(cleared).toEqual({ ...slots[REWARD_TYPES.GAME_OR_CHANCE], rewardId: null });
  });

  test('surfaces a Twitch delete failure', async () => {
    const original = apiFetch({ rewards: [{ id: 'reward-id', title: 'Reward' }] });
    const fetch = vi.fn(async (url, options = {}) => {
      if ((options.method ?? 'GET') === 'DELETE') {
        return response({ message: 'Forbidden' }, { ok: false, status: 403 });
      }
      return original(url, options);
    });
    const twitch = integration(fetch);
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.CHANCE_ONLY].rewardId = 'reward-id';
    await twitch.init(slots);

    await expect(twitch.deleteReward(REWARD_TYPES.CHANCE_ONLY, 'reward-id')).rejects.toThrow('Forbidden');
  });
});

describe('Twitch EventSub', () => {
  test('opens one socket and subscribes separately to both configured reward IDs', async () => {
    FakeSocket.instances.length = 0;
    const rewards = [
      { id: 'game-reward', title: 'Game reward' },
      { id: 'chance-reward', title: 'Chance reward' }
    ];
    const fetch = apiFetch({ rewards });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    slots[REWARD_TYPES.CHANCE_ONLY].rewardId = 'chance-reward';
    const twitch = integration(fetch);
    const { verifiedSlots } = await twitch.init(slots);

    twitch.syncRewards(verifiedSlots);
    await FakeSocket.instances[0].emit({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'session-id' } }
    });

    expect(FakeSocket.instances).toHaveLength(1);
    const subscriptions = fetch.mock.calls
      .filter(([, options]) => options?.method === 'POST')
      .map(([, options]) => JSON.parse(options.body));
    expect(subscriptions).toEqual([
      {
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: 'broadcaster', reward_id: 'game-reward' },
        transport: { method: 'websocket', session_id: 'session-id' }
      },
      {
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: 'broadcaster', reward_id: 'chance-reward' },
        transport: { method: 'websocket', session_id: 'session-id' }
      }
    ]);
  });

  test('reports a live connection after both subscriptions are ready', async () => {
    FakeSocket.instances.length = 0;
    const onStatus = vi.fn();
    const fetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Game reward' }] });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch, { onStatus });
    const { verifiedSlots } = await twitch.init(slots);

    twitch.syncRewards(verifiedSlots);
    await FakeSocket.instances[0].emit({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'session-id' } }
    });

    expect(onStatus).toHaveBeenLastCalledWith({
      scope: 'connection',
      type: null,
      state: 'live',
      message: 'Twitch-заявки слухаємо наживо.'
    });
  });

  test('ignores a subscription failure from a socket closed after removing all rewards', async () => {
    FakeSocket.instances.length = 0;
    let finishSubscription;
    const subscriptionResponse = new Promise(resolve => {
      finishSubscription = resolve;
    });
    const baseFetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Game reward' }] });
    const fetch = vi.fn((url, options) => (
      url.includes('/helix/eventsub/subscriptions')
        ? subscriptionResponse
        : baseFetch(url, options)
    ));
    const onStatus = vi.fn();
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch, { onStatus });
    const { verifiedSlots } = await twitch.init(slots);
    twitch.syncRewards(verifiedSlots);

    const staleWelcome = FakeSocket.instances[0].emit({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'closed-session' } }
    });
    twitch.syncRewards(createDefaultTwitchState().rewards);
    finishSubscription(response(
      { message: 'websocket transport session does not exist or has already disconnected' },
      { ok: false, status: 400 }
    ));
    await staleWelcome;

    expect(onStatus).toHaveBeenLastCalledWith({
      scope: 'connection',
      type: null,
      state: 'idle',
      message: 'Прослуховування вимкнено.'
    });
  });

  test('emits normalized requests only for configured rewards and never fulfills them', async () => {
    FakeSocket.instances.length = 0;
    const onRedemption = vi.fn();
    const fetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Configured title' }] });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch, {
      onRedemption,
      now: () => new Date('2026-08-20T12:00:00.000Z')
    });
    const { verifiedSlots } = await twitch.init(slots);
    twitch.syncRewards(verifiedSlots);
    const socket = FakeSocket.instances[0];

    await socket.emit({
      metadata: {
        message_type: 'notification',
        subscription_type: 'channel.channel_points_custom_reward_redemption.add'
      },
      payload: { event: { id: 'ignored', reward: { id: 'other' }, user_input: 'Other game' } }
    });
    await socket.emit({
      metadata: {
        message_type: 'notification',
        subscription_type: 'channel.channel_points_custom_reward_redemption.add'
      },
      payload: {
        event: {
          id: 'redemption-id',
          reward: { id: 'game-reward', title: 'Configured title' },
          user_id: 'viewer-id',
          user_name: 'Viewer',
          user_input: '  Hollow   Knight  ',
          redeemed_at: '2026-08-20T11:59:00.000Z'
        }
      }
    });

    expect(onRedemption).toHaveBeenCalledOnce();
    expect(onRedemption).toHaveBeenCalledWith({
      id: 'redemption-id',
      rewardType: REWARD_TYPES.GAME_OR_CHANCE,
      rewardId: 'game-reward',
      rewardTitle: 'Configured title',
      viewerId: 'viewer-id',
      viewerName: 'Viewer',
      input: 'Hollow Knight',
      redeemedAt: '2026-08-20T11:59:00.000Z',
      receivedAt: '2026-08-20T12:00:00.000Z'
    });
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  test('follows Twitch reconnect URLs and closes the active socket on destroy', async () => {
    FakeSocket.instances.length = 0;
    const fetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Game reward' }] });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch);
    const { verifiedSlots } = await twitch.init(slots);
    twitch.syncRewards(verifiedSlots);
    const first = FakeSocket.instances[0];

    await first.emit({
      metadata: { message_type: 'session_reconnect' },
      payload: { session: { reconnect_url: 'wss://reconnect.test/ws' } }
    });
    twitch.destroy();

    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.instances[1].url).toBe('wss://reconnect.test/ws');
    expect(first.close).toHaveBeenCalledOnce();
    expect(FakeSocket.instances[1].close).toHaveBeenCalledOnce();
  });

  test('closes the active socket and clears the session on logout', async () => {
    FakeSocket.instances.length = 0;
    const sessionStorage = storage();
    const fetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Game reward' }] });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch, { sessionStorage });
    const { verifiedSlots } = await twitch.init(slots);
    twitch.syncRewards(verifiedSlots);

    twitch.logout();

    expect(FakeSocket.instances[0].close).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('twitch_token_v1')).toBeNull();
  });

  test('cancels a scheduled reconnect when listening is destroyed', async () => {
    FakeSocket.instances.length = 0;
    let retry;
    const clearTimer = vi.fn();
    const fetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Game reward' }] });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch, {
      setTimer: vi.fn(callback => {
        retry = callback;
        return 42;
      }),
      clearTimer
    });
    const { verifiedSlots } = await twitch.init(slots);
    twitch.syncRewards(verifiedSlots);

    FakeSocket.instances[0].onclose();
    twitch.destroy();
    retry();

    expect(clearTimer).toHaveBeenCalledWith(42);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  test('ignores a delayed reconnect message after destroy', async () => {
    FakeSocket.instances.length = 0;
    const fetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Game reward' }] });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch);
    const { verifiedSlots } = await twitch.init(slots);
    twitch.syncRewards(verifiedSlots);
    const staleSocket = FakeSocket.instances[0];

    twitch.destroy();
    await staleSocket.emit({
      metadata: { message_type: 'session_reconnect' },
      payload: { session: { reconnect_url: 'wss://too-late.test/ws' } }
    });

    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe('Twitch redemption reconciliation', () => {
  test('manual refresh returns recovered requests and restarts live listening', async () => {
    FakeSocket.instances.length = 0;
    const rewardId = 'game-reward';
    const baseFetch = apiFetch({ rewards: [{ id: rewardId, title: 'Game reward' }] });
    let redemptionCall = 0;
    const fetch = vi.fn(async (url, options = {}) => {
      if (!url.includes('/redemptions?')) return baseFetch(url, options);
      redemptionCall += 1;
      return response(redemptionCall === 1
        ? { data: [], pagination: {} }
        : {
            data: [{
              id: 'recovered',
              reward: { id: rewardId, title: 'Game reward' },
              user_id: 'viewer-recovered',
              user_name: 'Recovered Viewer',
              user_input: 'Recovered game',
              redeemed_at: '2026-08-20T12:30:00.000Z'
            }],
            pagination: {}
          });
    });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = rewardId;
    const twitch = integration(fetch, { now: () => new Date('2026-08-20T13:00:00.000Z') });
    const { verifiedSlots } = await twitch.init(slots);
    twitch.syncRewards(verifiedSlots);
    const firstSocket = FakeSocket.instances[0];

    const result = await twitch.refreshRedemptions();

    expect(result.reconciledRedemptions.map(request => request.id)).toEqual(['recovered']);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(firstSocket.close).toHaveBeenCalledOnce();
  });

  test('loads only the last 12 hours and stops paging after the cutoff', async () => {
    const rewardId = 'game-reward';
    const baseFetch = apiFetch({ rewards: [{ id: rewardId, title: 'Game reward' }] });
    const redemption = (id, redeemedAt) => ({
      id,
      reward: { id: rewardId, title: 'Game reward' },
      user_id: `viewer-${id}`,
      user_name: `Viewer ${id}`,
      user_input: `Game ${id}`,
      redeemed_at: redeemedAt
    });
    const fetch = vi.fn(async (url, options = {}) => {
      if (!url.includes('/redemptions?')) return baseFetch(url, options);
      const after = new URL(url).searchParams.get('after');
      if (after === 'older-page') {
        return response({
          data: [redemption('ancient', '2026-08-19T00:00:00.000Z')],
          pagination: {}
        });
      }
      return response({
        data: [
          redemption('recent', '2026-08-20T12:00:00.000Z'),
          redemption('boundary', '2026-08-20T01:00:00.000Z'),
          redemption('old', '2026-08-20T00:59:59.999Z')
        ],
        pagination: { cursor: 'older-page' }
      });
    });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = rewardId;
    const twitch = integration(fetch, { now: () => new Date('2026-08-20T13:00:00.000Z') });

    const result = await twitch.init(slots);

    expect(result.unfulfilledRedemptionIds).toEqual(['boundary', 'recent']);
    const redemptionQueries = fetch.mock.calls
      .filter(([url]) => url.includes('/redemptions?'))
      .map(([url]) => new URL(url).searchParams);
    expect(redemptionQueries).toHaveLength(1);
    expect(redemptionQueries[0].get('sort')).toBe('NEWEST');
    expect(redemptionQueries[0].get('first')).toBe('50');
  });

  test('loads every unfulfilled page, deduplicates requests, and returns them oldest first', async () => {
    const rewards = [
      { id: 'game-reward', title: 'Game reward' },
      { id: 'chance-reward', title: 'Chance reward' }
    ];
    const baseFetch = apiFetch({ rewards });
    const redemption = (id, rewardId, redeemedAt, input) => ({
      id,
      reward: { id: rewardId, title: rewardId === 'game-reward' ? 'Game reward' : 'Chance reward' },
      user_id: `viewer-${id}`,
      user_name: `Viewer ${id}`,
      user_input: input,
      redeemed_at: redeemedAt
    });
    const fetch = vi.fn(async (url, options = {}) => {
      if (!url.includes('/redemptions?')) return baseFetch(url, options);
      const query = new URL(url).searchParams;
      const rewardId = query.get('reward_id');
      const after = query.get('after');
      if (rewardId === 'game-reward' && !after) {
        return response({
          data: [
            redemption('b', rewardId, '2026-08-20T12:00:00.000Z', '  Later game '),
            redemption('a', rewardId, '2026-08-20T10:00:00.000Z', ' First   game ')
          ],
          pagination: { cursor: 'next-page' }
        });
      }
      if (rewardId === 'game-reward' && after === 'next-page') {
        return response({
          data: [redemption('b', rewardId, '2026-08-20T12:00:00.000Z', 'Later game')],
          pagination: {}
        });
      }
      return response({
        data: [redemption('c', rewardId, '2026-08-20T11:00:00.000Z', ' Chance game ')],
        pagination: {}
      });
    });
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    slots[REWARD_TYPES.CHANCE_ONLY].rewardId = 'chance-reward';
    const twitch = integration(fetch, { now: () => new Date('2026-08-20T13:00:00.000Z') });

    const result = await twitch.init(slots);

    expect(result.unfulfilledRedemptionIds).toEqual(['a', 'c', 'b']);
    expect(result.reconciledRedemptions.map(item => ({
      id: item.id,
      rewardType: item.rewardType,
      input: item.input,
      receivedAt: item.receivedAt
    }))).toEqual([
      {
        id: 'a',
        rewardType: REWARD_TYPES.GAME_OR_CHANCE,
        input: 'First game',
        receivedAt: '2026-08-20T13:00:00.000Z'
      },
      {
        id: 'c',
        rewardType: REWARD_TYPES.CHANCE_ONLY,
        input: 'Chance game',
        receivedAt: '2026-08-20T13:00:00.000Z'
      },
      {
        id: 'b',
        rewardType: REWARD_TYPES.GAME_OR_CHANCE,
        input: 'Later game',
        receivedAt: '2026-08-20T13:00:00.000Z'
      }
    ]);
    const queries = fetch.mock.calls
      .filter(([url]) => url.includes('/redemptions?'))
      .map(([url]) => new URL(url).searchParams);
    expect(queries).toHaveLength(3);
    expect(queries.every(query => (
      query.get('status') === 'UNFULFILLED'
      && query.get('sort') === 'NEWEST'
      && query.get('first') === '50'
    ))).toBe(true);
    expect(queries[1].get('after')).toBe('next-page');
  });

  test('keeps verified rewards available when reconciliation fails', async () => {
    const baseFetch = apiFetch({ rewards: [{ id: 'game-reward', title: 'Game reward' }] });
    const fetch = vi.fn(async (url, options) => (
      url.includes('/redemptions?')
        ? response({ message: 'Temporary outage' }, { ok: false, status: 503 })
        : baseFetch(url, options)
    ));
    const onStatus = vi.fn();
    const slots = createDefaultTwitchState().rewards;
    slots[REWARD_TYPES.GAME_OR_CHANCE].rewardId = 'game-reward';
    const twitch = integration(fetch, { onStatus });

    const result = await twitch.init(slots);

    expect(result.verifiedSlots[REWARD_TYPES.GAME_OR_CHANCE].rewardId).toBe('game-reward');
    expect(result.reconciledRedemptions).toEqual([]);
    expect(result.unfulfilledRedemptionIds).toBeNull();
    expect(onStatus).toHaveBeenCalledWith({
      scope: 'connection',
      type: null,
      state: 'error',
      message: 'Не вдалося відновити пропущені Twitch-заявки: Temporary outage'
    });
  });
});
