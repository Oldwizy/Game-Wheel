const ACTIVE_PHASES = new Set(['animating', 'awaiting-wheel-decision', 'resolving']);

export function controlStateForPhase(phase) {
  const active = ACTIVE_PHASES.has(phase);
  const finished = phase === 'finished';
  return {
    mode: active,
    shuffle: active,
    copies: active || finished,
    duration: active,
    instant: active || finished,
    start: active || finished,
    back: active,
    logReturn: active,
    wheelDecision: phase !== 'awaiting-wheel-decision'
  };
}

function setDisabled(elements, disabled) {
  if (!elements) return;
  const list = typeof elements[Symbol.iterator] === 'function' && typeof elements !== 'string'
    ? elements
    : [elements];
  for (const element of list) {
    if (element) element.disabled = disabled;
  }
}

export function applyControlState(elements, state) {
  setDisabled(elements.modeButtons, state.mode);
  setDisabled(elements.shuffle, state.shuffle);
  setDisabled(elements.copySteppers, state.copies);
  setDisabled(elements.duration, state.duration);
  setDisabled(elements.instant, state.instant);
  setDisabled(elements.start, state.start);
  setDisabled(elements.back, state.back);
  setDisabled(elements.logReturnButtons, state.logReturn);
  setDisabled(elements.wheelDecisionButtons, state.wheelDecision);
}
