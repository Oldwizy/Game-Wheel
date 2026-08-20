import { expect, test, vi } from 'vitest';
import { RoundController } from '../../src/draw/round-controller.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('Wheel play completion stays provisional until a decision', async () => {
  const commitResult = vi.fn();
  const play = vi.fn().mockResolvedValue({ kind: 'wheel-complete', targetId: 2, landedSectorIndex: 3 });
  const controller = new RoundController({
    selectTarget: () => ({ id: 2 }),
    visualizationFor: () => ({ play, cancel: vi.fn() }),
    commitResult,
    onPhaseChange: vi.fn(),
    onError: vi.fn()
  });

  await controller.start({ mode: 'wheel', games: [{ id: 2, copies: 1 }], durationMs: 2000 });

  expect(controller.phase).toBe('awaiting-wheel-decision');
  expect(commitResult).not.toHaveBeenCalled();
  await controller.decideWheel('remove');
  expect(commitResult).toHaveBeenCalledWith(expect.objectContaining({ decision: 'remove' }));
  expect(controller.phase).toBe('idle');
});

test('external abort discards a landed Wheel result before its decision', async () => {
  const commitResult = vi.fn();
  const visualization = {
    play: vi.fn().mockResolvedValue({ kind: 'wheel-complete', targetId: 2, landedSectorIndex: 0 }),
    cancel: vi.fn()
  };
  const controller = new RoundController({
    selectTarget: () => ({ id: 2 }),
    visualizationFor: () => visualization,
    commitResult,
    onPhaseChange: vi.fn(),
    onError: vi.fn()
  });
  const external = new AbortController();
  await controller.start({
    mode: 'wheel',
    games: [{ id: 2, copies: 1 }],
    durationMs: 2000,
    signal: external.signal
  });

  external.abort();

  expect(controller.phase).toBe('idle');
  expect(visualization.cancel).toHaveBeenCalledOnce();
  expect(commitResult).not.toHaveBeenCalled();
});

test('Slot commits its typed visualization result before returning idle', async () => {
  const commitResult = vi.fn().mockResolvedValue(undefined);
  const result = { kind: 'slot-complete', targetId: 2 };
  const controller = new RoundController({
    selectTarget: () => ({ id: 2 }),
    visualizationFor: () => ({ play: vi.fn().mockResolvedValue(result), cancel: vi.fn() }),
    commitResult,
    onPhaseChange: vi.fn(),
    onError: vi.fn()
  });

  await controller.start({ mode: 'slot', games: [{ id: 2, copies: 1 }], durationMs: 2000 });

  expect(commitResult).toHaveBeenCalledWith(result);
  expect(controller.phase).toBe('idle');
});

test.each(['external-abort', 'imperative-cancel'])('%s rejects play with AbortError and commits nothing', async path => {
  const pending = deferred();
  const commitResult = vi.fn();
  const visualization = {
    play: vi.fn(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      pending.promise.then(resolve, reject);
    })),
    cancel: vi.fn()
  };
  const controller = new RoundController({
    selectTarget: () => ({ id: 1 }),
    visualizationFor: () => visualization,
    commitResult,
    onPhaseChange: vi.fn(),
    onError: vi.fn()
  });
  const external = new AbortController();
  const running = controller.start({
    mode: 'slot',
    games: [{ id: 1, copies: 1 }],
    durationMs: 2000,
    signal: external.signal
  });

  path === 'external-abort' ? external.abort() : controller.cancel();

  await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  expect(controller.phase).toBe('idle');
  expect(commitResult).not.toHaveBeenCalled();
});

test('a visualization error returns to idle and commits nothing', async () => {
  const commitResult = vi.fn();
  const onError = vi.fn();
  const controller = new RoundController({
    selectTarget: () => ({ id: 1 }),
    visualizationFor: () => ({ play: () => Promise.reject(new Error('render failed')), cancel: vi.fn() }),
    commitResult,
    onPhaseChange: vi.fn(),
    onError
  });

  await expect(controller.start({
    mode: 'slot',
    games: [{ id: 1, copies: 1 }],
    durationMs: 2000
  })).rejects.toThrow('render failed');

  expect(controller.phase).toBe('idle');
  expect(commitResult).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
});

test('cancel is safe when no round is active', () => {
  const controller = new RoundController({
    selectTarget: vi.fn(),
    visualizationFor: vi.fn(),
    commitResult: vi.fn(),
    onPhaseChange: vi.fn(),
    onError: vi.fn()
  });

  expect(() => controller.cancel()).not.toThrow();
  expect(controller.phase).toBe('idle');
});
