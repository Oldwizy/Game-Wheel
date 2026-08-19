import { expect, test } from 'vitest';
import {
  createProgressKeyframes,
  suspenseTailMs,
  velocityProfileForDuration
} from '../../src/draw/motion-profile.js';

test.each([
  [2000, 1200],
  [5000, 3000],
  [10000, 5000],
  [15000, 6000],
  [30000, 9000],
  [60000, 9000]
])('a %i ms round gets a %i ms suspense tail', (durationMs, expectedTailMs) => {
  expect(suspenseTailMs(durationMs)).toBe(expectedTailMs);
});

test('duration profile converts the suspense tail into a deceleration fraction', () => {
  expect(velocityProfileForDuration(15000)).toMatchObject({ acceleration: 0.12, deceleration: 0.4 });
  expect(velocityProfileForDuration(60000)).toMatchObject({ acceleration: 0.12, deceleration: 0.15 });
});

test('shared progress remains continuous and spends the configured tail slowing down', () => {
  const durationMs = 15000;
  const { keyframes, profile } = createProgressKeyframes({ durationMs, samples: 300 });
  const decelerationStart = 1 - profile.deceleration;
  const tailFrames = keyframes.filter(frame => frame.offset >= decelerationStart);

  expect(decelerationStart * durationMs).toBe(9000);
  expect(tailFrames[0].offset).toBeCloseTo(0.6, 2);
  expect(tailFrames.at(-1)).toEqual({ offset: 1, progress: 1 });

  let previousStep = Infinity;
  for (let index = 1; index < tailFrames.length; index += 1) {
    const step = tailFrames[index].progress - tailFrames[index - 1].progress;
    expect(step).toBeLessThanOrEqual(previousStep + 1e-10);
    previousStep = step;
  }
});
