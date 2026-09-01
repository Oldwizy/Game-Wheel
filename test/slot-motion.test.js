import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionKeyframes, velocityAt } from '../src/draw/slot.js';

test('slot reel keeps active travel for the final fifth of the spin', () => {
  const motion = createMotionKeyframes({
    startTranslateY: 0,
    finalTranslateY: -1000,
    targetIndex: 20,
    durationMs: 5000,
    samples: 20
  });

  const frameAtFourSeconds = motion.keyframes.find(frame => frame.offset === 0.8);

  assert.ok(frameAtFourSeconds);
  assert.ok(Number.parseFloat(frameAtFourSeconds.transform.match(/-?[\d.]+/)[0]) >= -880);
});

test('slot reel keeps near-peak speed through the first 90 percent of its spin', () => {
  const motion = createMotionKeyframes({
    startTranslateY: 0,
    finalTranslateY: -1000,
    targetIndex: 20,
    durationMs: 5000
  });

  assert.ok(velocityAt(0.9, motion.profile) >= 0.95);
});

test('slot reel moves game names horizontally through the matchmaking window', () => {
  const motion = createMotionKeyframes({
    startTranslateY: 0,
    finalTranslateY: -1000,
    targetIndex: 20,
    durationMs: 5000
  });

  assert.match(motion.keyframes[0].transform, /^translateX\(/);
});
