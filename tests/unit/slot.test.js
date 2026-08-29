import { expect, test, vi } from 'vitest';
import {
  buildReelModel,
  createMotionKeyframes,
  createSlotVisualization,
  velocityAt
} from '../../src/draw/slot.js';

function fakeElements(animationFactory) {
  const strip = {
    style: {},
    children: [],
    replaceChildren: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    animate: vi.fn(animationFactory),
    getAnimations: () => []
  };
  return {
    strip,
    machine: { classList: { add: vi.fn(), remove: vi.fn() } },
    window: { clientHeight: 280 },
    rowHeight: 56
  };
}

function pendingAnimation() {
  return {
    cancel: vi.fn(),
    finished: new Promise(() => {})
  };
}

test('buildReelModel centers the selected target with enough trailing rows', () => {
  const games = [{ id: 1, copies: 1 }, { id: 2, copies: 1 }, { id: 3, copies: 1 }];

  const model = buildReelModel({ games, targetId: 2, visibleRows: 5, durationMs: 2000, random: () => 0 });

  expect(model.items[model.targetIndex].id).toBe(2);
  expect(model.items.length - model.targetIndex - 1).toBeGreaterThanOrEqual(2);
});

test('target insertion avoids an adjacent duplicate when a valid arrangement exists', () => {
  const games = [{ id: 1, copies: 2 }, { id: 2, copies: 2 }, { id: 3, copies: 1 }];

  const model = buildReelModel({ games, targetId: 1, visibleRows: 3, durationMs: 2000, random: () => 0 });

  expect(model.items[model.targetIndex - 1].id).not.toBe(1);
  expect(model.items[model.targetIndex + 1].id).not.toBe(1);
});

test('velocity is continuous at acceleration and deceleration boundaries', () => {
  const profile = { acceleration: 0.12, deceleration: 0.25 };
  const epsilon = 1e-6;
  for (const boundary of [profile.acceleration, 1 - profile.deceleration]) {
    const before = velocityAt(boundary - epsilon, profile);
    const after = velocityAt(boundary + epsilon, profile);
    expect(Math.abs(after - before)).toBeLessThan(1e-4);
  }
});

test('deceleration is monotonic and reaches zero', () => {
  const profile = { acceleration: 0.12, deceleration: 0.25 };
  const start = 1 - profile.deceleration;
  let previous = velocityAt(start, profile);

  for (let index = 1; index <= 100; index += 1) {
    const velocity = velocityAt(start + profile.deceleration * index / 100, profile);
    expect(velocity).toBeLessThanOrEqual(previous);
    previous = velocity;
  }
  expect(previous).toBe(0);
});

test('motion uses the original smooth deceleration and lands exactly on target', () => {
  const result = createMotionKeyframes({
    startTranslateY: 0,
    finalTranslateY: -1120,
    durationMs: 15000,
    samples: 120,
  });

  expect(result.keyframes.at(-1).transform).toBe('translateY(-1120px)');
  expect(result.keyframes[0].easing).toBe('cubic-bezier(0.15, 0.82, 0.22, 1)');
  expect(result.finalTranslateY).toBe(-1120);
});

test.each(['external-abort', 'imperative-cancel'])(
  '%s rejects Slot play with AbortError and cancels one animation once', async path => {
    const animation = pendingAnimation();
    const elements = fakeElements(() => animation);
    const visualization = createSlotVisualization(elements, {
      random: () => 0,
      prefersReducedMotion: false
    });
    const games = [{ id: 1, name: 'Alpha', copies: 1 }, { id: 2, name: 'Beta', copies: 1 }];
    const external = new AbortController();
    const running = visualization.play({
      target: games[0],
      games,
      durationMs: 2000,
      signal: external.signal
    });

    path === 'external-abort' ? external.abort() : visualization.cancel();
    visualization.cancel();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(animation.cancel).toHaveBeenCalledOnce();
  }
);

test('reduced motion caps playback and resolves the selected target', async () => {
  let options;
  const animation = {
    cancel: vi.fn(),
    commitStyles: vi.fn(),
    finished: Promise.resolve()
  };
  const elements = fakeElements((_, animationOptions) => {
    options = animationOptions;
    return animation;
  });
  const visualization = createSlotVisualization(elements, {
    random: () => 0,
    prefersReducedMotion: true
  });
  const games = [{ id: 1, name: 'Alpha', copies: 1 }, { id: 2, name: 'Beta', copies: 1 }];

  const result = await visualization.play({
    target: games[1],
    games,
    durationMs: 5000,
    signal: new AbortController().signal
  });

  expect(options.duration).toBeLessThanOrEqual(120);
  expect(result).toEqual({ kind: 'slot-complete', targetId: 2 });
});

test('destroy permanently rejects later render and play operations', async () => {
  const elements = fakeElements(pendingAnimation);
  const visualization = createSlotVisualization(elements, {
    random: () => 0,
    prefersReducedMotion: false
  });

  visualization.destroy();

  expect(() => visualization.render({ games: [] })).toThrow(expect.objectContaining({ code: 'VISUALIZATION_DESTROYED' }));
  await expect(visualization.play({
    target: { id: 1 },
    games: [{ id: 1, name: 'Alpha', copies: 1 }],
    durationMs: 100,
    signal: new AbortController().signal
  })).rejects.toMatchObject({ code: 'VISUALIZATION_DESTROYED' });
});
