import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReelModel, createMotionKeyframes } from '../src/draw/slot.js';

test('slot reel provides a rapid drum travel for a 15-second round', () => {
  const games = [
    { id: 1, name: 'Alpha', copies: 1 },
    { id: 2, name: 'Beta', copies: 1 },
    { id: 3, name: 'Gamma', copies: 1 }
  ];

  const reel = buildReelModel({
    games,
    targetId: 1,
    visibleRows: 3,
    durationMs: 15000,
    random: () => 0
  });

  assert.ok(reel.travelRows >= 170);
});

test('slot reel keeps rapid travel until the final fifth of the spin', () => {
  const motion = createMotionKeyframes({
    startTranslateY: 0,
    finalTranslateY: -1000,
    targetIndex: 20,
    durationMs: 5000,
    samples: 20
  });

  const frameAtFourSeconds = motion.keyframes.find(frame => frame.offset === 0.8);

  assert.ok(frameAtFourSeconds);
  assert.ok(Number.parseFloat(frameAtFourSeconds.transform.match(/-?[\d.]+/)[0]) >= -900);
});

test('slot reel overshoots then bounces back to the selected row', () => {
  const motion = createMotionKeyframes({
    startTranslateY: 0,
    finalTranslateY: -1000,
    targetIndex: 20,
    durationMs: 5000,
    samples: 20
  });

  const overshootFrame = motion.keyframes.at(-3);

  assert.ok(Number.parseFloat(overshootFrame.transform.match(/-?[\d.]+/)[0]) < -1000);
  assert.equal(motion.keyframes.at(-1).transform, 'translateY(-1000px)');
});

test('slot reel moves game names vertically through the matchmaking window', () => {
  const motion = createMotionKeyframes({
    startTranslateY: 0,
    finalTranslateY: -1000,
    targetIndex: 20,
    durationMs: 5000
  });

  assert.match(motion.keyframes[0].transform, /^translateY\(/);
});
