import { expect, test, vi } from 'vitest';
import {
  computeTargetRotation,
  createInitialWheelOrder,
  createWheelVisualization,
  reconcileWheelOrder,
  selectTargetSector
} from '../../src/draw/wheel.js';

const order = [
  { entryId: 'a1', gameId: 1 },
  { entryId: 'b1', gameId: 2 },
  { entryId: 'a2', gameId: 1 },
  { entryId: 'c1', gameId: 3 }
];

function retainedIds(before, after) {
  const afterIds = new Set(after.map(entry => entry.entryId));
  return before.map(entry => entry.entryId).filter(id => afterIds.has(id));
}

function fakeElements(animationFactory) {
  const svg = {
    style: {},
    animate: vi.fn(animationFactory),
    getAnimations: () => []
  };
  return {
    svg,
    stage: {
      querySelector: () => svg,
      style: {},
      replaceChildren: vi.fn()
    },
    machine: { classList: { add: vi.fn(), remove: vi.fn() } },
    pointer: { style: {} }
  };
}

function pendingAnimation() {
  return {
    currentTime: 0,
    cancel: vi.fn(),
    finished: new Promise(() => {})
  };
}

test('copy increase inserts one entry while preserving all existing relative order', () => {
  const games = [{ id: 1, copies: 3 }, { id: 2, copies: 1 }, { id: 3, copies: 1 }];

  const next = reconcileWheelOrder(order, games, { type: 'increase', gameId: 1 }, () => 'a3');

  expect(retainedIds(order, next)).toEqual(order.map(entry => entry.entryId));
  expect(next.filter(entry => entry.gameId === 1)).toHaveLength(3);
});

test('landed removal removes exactly that index and preserves every other entry', () => {
  const games = [{ id: 1, copies: 1 }, { id: 2, copies: 1 }, { id: 3, copies: 1 }];

  const next = reconcileWheelOrder(order, games, { type: 'landed-remove', index: 2 }, () => 'unused');

  expect(next.map(entry => entry.entryId)).toEqual(['a1', 'b1', 'c1']);
});

test('game removal and ordinary copy decrease preserve remaining relative order', () => {
  const removeGame = reconcileWheelOrder(
    order,
    [{ id: 1, copies: 2 }, { id: 3, copies: 1 }],
    { type: 'remove-game', gameId: 2 }
  );
  const decrease = reconcileWheelOrder(
    order,
    [{ id: 1, copies: 1 }, { id: 2, copies: 1 }, { id: 3, copies: 1 }],
    { type: 'decrease', gameId: 1 }
  );

  expect(removeGame.map(entry => entry.entryId)).toEqual(['a1', 'a2', 'c1']);
  expect(decrease.map(entry => entry.entryId)).toEqual(['a1', 'b1', 'c1']);
});

test('fallback insertion uses canonical sector distance and the lowest matching index on ties', () => {
  const crowded = [
    { entryId: 'a1', gameId: 1 },
    { entryId: 'a2', gameId: 1 },
    { entryId: 'a3', gameId: 1 }
  ];

  const next = reconcileWheelOrder(crowded, [{ id: 1, copies: 4 }], { type: 'increase', gameId: 1 }, () => 'a4');

  expect(next.map(entry => entry.entryId)).toEqual(['a1', 'a4', 'a2', 'a3']);
});

test('initial order creates one stable entry per copy and avoids feasible circular adjacency', () => {
  let nextId = 0;
  const games = [{ id: 1, copies: 2 }, { id: 2, copies: 2 }];

  const result = createInitialWheelOrder(games, () => `entry-${++nextId}`, () => 0);

  expect(result.map(entry => entry.entryId).sort()).toEqual(['entry-1', 'entry-2', 'entry-3', 'entry-4']);
  result.forEach((entry, index) => {
    expect(entry.gameId).not.toBe(result[(index + 1) % result.length].gameId);
  });
});

test('target sector selection uses only matching canonical entries', () => {
  expect(selectTargetSector(order, 1, () => 0)).toBe(0);
  expect(selectTargetSector(order, 1, () => 0.999)).toBe(2);
  expect(() => selectTargetSector(order, 99, () => 0)).toThrow(RangeError);
});

test('target rotation continues clockwise from current rotation and lands inside the sector margin', () => {
  const currentRotation = 725;
  const result = computeTargetRotation({
    currentRotation,
    landedSectorIndex: 2,
    sectorCount: 4,
    durationMs: 2000,
    random: () => 0.5
  });

  expect(result).toBeGreaterThan(currentRotation + 360);
  const normalized = ((result % 360) + 360) % 360;
  expect(normalized).toBeGreaterThan(180);
  expect(normalized).toBeLessThan(270);
});

test.each(['external-abort', 'imperative-cancel'])(
  '%s rejects Wheel play with AbortError and cancels animation once', async path => {
    const animation = pendingAnimation();
    const elements = fakeElements(() => animation);
    const visualization = createWheelVisualization(elements, {
      random: () => 0,
      prefersReducedMotion: false,
      makeEntryId: () => 'entry-1'
    });
    visualization.initialize([{ id: 1, name: 'Alpha', copies: 1 }]);
    const external = new AbortController();
    const running = visualization.play({
      target: { id: 1 },
      durationMs: 2000,
      signal: external.signal
    });

    path === 'external-abort' ? external.abort() : visualization.cancel();
    visualization.cancel();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(animation.cancel).toHaveBeenCalledOnce();
  }
);

test('reduced motion caps duration and adds no full turn', async () => {
  let captured;
  const animation = {
    currentTime: 0,
    cancel: vi.fn(),
    commitStyles: vi.fn(),
    finished: Promise.resolve()
  };
  const elements = fakeElements((keyframes, options) => {
    captured = { keyframes, options };
    return animation;
  });
  const visualization = createWheelVisualization(elements, {
    random: () => 0.5,
    prefersReducedMotion: true,
    makeEntryId: () => 'entry-1'
  });
  visualization.initialize([{ id: 1, name: 'Alpha', copies: 1 }]);

  await visualization.play({ target: { id: 1 }, durationMs: 5000, signal: new AbortController().signal });

  const start = Number(captured.keyframes[0].transform.match(/-?[\d.]+/)[0]);
  const end = Number(captured.keyframes[1].transform.match(/-?[\d.]+/)[0]);
  expect(captured.options.duration).toBeLessThanOrEqual(120);
  expect(end - start).toBeLessThan(360);
});

test('normal motion uses the shared duration-based suspense curve', async () => {
  let captured;
  const animation = {
    currentTime: 0,
    cancel: vi.fn(),
    commitStyles: vi.fn(),
    finished: Promise.resolve()
  };
  const elements = fakeElements((keyframes, options) => {
    captured = { keyframes, options };
    return animation;
  });
  const visualization = createWheelVisualization(elements, {
    random: () => 0.5,
    prefersReducedMotion: false,
    makeEntryId: () => 'entry-1'
  });
  visualization.initialize([{ id: 1, name: 'Alpha', copies: 1 }]);

  await visualization.play({ target: { id: 1 }, durationMs: 15000, signal: new AbortController().signal });

  expect(captured.options.duration).toBe(15000);
  expect(captured.keyframes.length).toBeGreaterThan(100);
  expect(captured.keyframes.find(frame => frame.offset === 0.6)).toBeDefined();
});

test('initialize creates canonical entries only once across render and play', async () => {
  const makeEntryId = vi.fn()
    .mockReturnValueOnce('a1')
    .mockReturnValueOnce('b1');
  const animation = {
    currentTime: 0,
    cancel: vi.fn(),
    commitStyles: vi.fn(),
    finished: Promise.resolve()
  };
  const elements = fakeElements(() => animation);
  const visualization = createWheelVisualization(elements, {
    random: () => 0,
    prefersReducedMotion: true,
    makeEntryId
  });
  const games = [{ id: 1, name: 'Alpha', copies: 1 }, { id: 2, name: 'Beta', copies: 1 }];

  visualization.initialize(games);
  visualization.render({ games });
  visualization.render({ games });
  await visualization.play({ target: games[0], durationMs: 2000, signal: new AbortController().signal });

  expect(makeEntryId).toHaveBeenCalledTimes(2);
});

test('destroy permanently rejects later render and play operations', async () => {
  const elements = fakeElements(pendingAnimation);
  const visualization = createWheelVisualization(elements, {
    random: () => 0,
    prefersReducedMotion: false,
    makeEntryId: () => 'entry-1'
  });
  visualization.initialize([{ id: 1, name: 'Alpha', copies: 1 }]);

  visualization.destroy();

  expect(() => visualization.render({ games: [] })).toThrow(expect.objectContaining({ code: 'VISUALIZATION_DESTROYED' }));
  await expect(visualization.play({
    target: { id: 1 },
    durationMs: 100,
    signal: new AbortController().signal
  })).rejects.toMatchObject({ code: 'VISUALIZATION_DESTROYED' });
});
