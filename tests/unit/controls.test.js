import { expect, test } from 'vitest';
import { applyControlState, controlStateForPhase } from '../../src/draw/controls.js';

test.each(['animating', 'awaiting-wheel-decision', 'resolving'])(
  '%s disables every conflicting control', phase => {
    const state = controlStateForPhase(phase);

    expect(state).toMatchObject({
      mode: true,
      shuffle: true,
      copies: true,
      duration: true,
      instant: true,
      start: true,
      back: true,
      logReturn: true
    });
  }
);

test('only Wheel decisions remain enabled while awaiting a decision', () => {
  expect(controlStateForPhase('awaiting-wheel-decision').wheelDecision).toBe(false);
  expect(controlStateForPhase('animating').wheelDecision).toBe(true);
});

test('applyControlState uses native disabled properties for every control group', () => {
  const control = () => ({ disabled: false });
  const elements = {
    modeButtons: [control(), control(), control()],
    shuffle: control(),
    copySteppers: [control(), control()],
    duration: control(),
    instant: control(),
    start: control(),
    back: control(),
    logReturnButtons: [control()],
    wheelDecisionButtons: [control(), control()]
  };

  applyControlState(elements, controlStateForPhase('animating'));

  expect(elements.modeButtons.every(element => element.disabled)).toBe(true);
  expect(elements.copySteppers.every(element => element.disabled)).toBe(true);
  expect(elements.back.disabled).toBe(true);
  expect(elements.wheelDecisionButtons.every(element => element.disabled)).toBe(true);
});
