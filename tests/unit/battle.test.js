import { expect, test, vi } from 'vitest';
import {
  ballHp,
  ballRadius,
  createBalls,
  createBattleVisualization,
  stepPhysics
} from '../../src/draw/battle.js';

function fakeElements() {
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn()
  };
  return {
    machine: {
      clientWidth: 200,
      clientHeight: 160,
      classList: { add: vi.fn(), remove: vi.fn() }
    },
    canvas: {
      style: {},
      width: 0,
      height: 0,
      getContext: vi.fn(() => context)
    },
    context
  };
}

function frameScheduler() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    requestFrame: vi.fn(callback => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    }),
    cancelFrame: vi.fn(id => callbacks.delete(id)),
    advance(timestamp) {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      pending.forEach(([, callback]) => callback(timestamp));
    },
    get size() { return callbacks.size; }
  };
}

test('copies add five HP after the first copy', () => {
  expect(ballHp({ copies: 1 })).toBe(100);
  expect(ballHp({ copies: 4 })).toBe(115);
  expect(ballRadius(100)).toBeGreaterThanOrEqual(20);
});

test('createBalls makes one arena participant per game', () => {
  const balls = createBalls({
    games: [{ id: 1, name: 'Alpha', copies: 1 }, { id: 2, name: 'Beta', copies: 2 }],
    width: 300,
    height: 200,
    speedFactor: 0.1,
    random: () => 0.5
  });

  expect(balls.map(ball => ball.gameId)).toEqual([1, 2]);
  expect(balls[1].hp).toBe(105);
});

test('stepPhysics clamps dt and keeps balls inside arena bounds', () => {
  const state = {
    width: 200,
    height: 100,
    balls: [{ gameId: 1, r: 10, x: 195, y: 50, vx: 100, vy: 0, hp: 100, maxHp: 100 }]
  };

  const next = stepPhysics(state, 2, { dealDamage: false, random: () => 0 });

  expect(next.dt).toBe(0.05);
  expect(next.balls[0].x).toBeLessThanOrEqual(190);
  expect(state.balls[0].x).toBe(195);
});

test('Battle resolves ordered unique eliminations and one survivor', async () => {
  const frames = frameScheduler();
  const elements = fakeElements();
  const visualization = createBattleVisualization(elements, {
    random: () => 0,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: () => 1000,
    battleConfig: { hpOverride: 1, hitCooldownMs: 0, damageMin: 1, damageMax: 1 }
  });
  const games = [
    { id: 1, name: 'Alpha', copies: 1 },
    { id: 2, name: 'Beta', copies: 1 },
    { id: 3, name: 'Gamma', copies: 1 }
  ];

  const running = visualization.play({ games, signal: new AbortController().signal });
  for (let index = 0; index < 10 && frames.size; index += 1) frames.advance(index * 16);
  const result = await running;

  expect(result.kind).toBe('battle-complete');
  expect(new Set(result.eliminatedIds).size).toBe(result.eliminatedIds.length);
  expect(result.eliminatedIds).toHaveLength(2);
  expect(result.eliminatedIds).not.toContain(result.survivorId);
  expect([1, 2, 3]).toContain(result.survivorId);
});

test.each(['external-abort', 'imperative-cancel'])(
  '%s rejects Battle play with AbortError and cancels one frame once', async path => {
    const frames = frameScheduler();
    const visualization = createBattleVisualization(fakeElements(), {
      random: () => 0.5,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      now: () => 0
    });
    const external = new AbortController();
    const running = visualization.play({
      games: [{ id: 1, name: 'Alpha', copies: 1 }, { id: 2, name: 'Beta', copies: 1 }],
      signal: external.signal
    });

    path === 'external-abort' ? external.abort() : visualization.cancel();
    visualization.cancel();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(frames.cancelFrame).toHaveBeenCalledOnce();
  }
);

test('destroy permanently rejects later render and play operations', async () => {
  const frames = frameScheduler();
  const visualization = createBattleVisualization(fakeElements(), {
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  visualization.destroy();

  expect(() => visualization.render({ games: [] })).toThrow(expect.objectContaining({ code: 'VISUALIZATION_DESTROYED' }));
  await expect(visualization.play({
    games: [{ id: 1, name: 'Alpha', copies: 1 }],
    signal: new AbortController().signal
  })).rejects.toMatchObject({ code: 'VISUALIZATION_DESTROYED' });
});
