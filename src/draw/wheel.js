import { shuffle, shuffleNoAdjacent } from '../core/random.js';
import { createProgressKeyframes } from './motion-profile.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const IDLE_DURATION_MS = 26000;
const REDUCED_MOTION_DURATION_MS = 120;
const PALETTE = ['#E85D5D', '#4ECDC4', '#FFB347', '#7C8CFF', '#C67CFF', '#69B56B', '#5DC8E8', '#FF8FB1', '#F2C14E', '#F2955A'];

function visualizationDestroyedError() {
  const error = new Error('Wheel visualization has been destroyed');
  error.code = 'VISUALIZATION_DESTROYED';
  return error;
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function gameCounts(games) {
  const counts = new Map();
  for (const game of games) {
    if (!Number.isInteger(game.id) || game.id <= 0 || !Number.isInteger(game.copies) || game.copies <= 0) {
      throw new TypeError('Wheel games require positive integer IDs and copies');
    }
    counts.set(game.id, game.copies);
  }
  return counts;
}

function countEntries(order) {
  const counts = new Map();
  for (const entry of order) counts.set(entry.gameId, (counts.get(entry.gameId) ?? 0) + 1);
  return counts;
}

export function createInitialWheelOrder(games, makeEntryId, random = Math.random) {
  gameCounts(games);
  const entries = games.flatMap(game => Array.from(
    { length: game.copies },
    () => ({ entryId: makeEntryId(), gameId: game.id })
  ));
  return shuffleNoAdjacent(entries, entry => entry.gameId, { circular: true }, random);
}

function findInsertionIndex(order, gameId) {
  if (order.length === 0) return 0;

  for (let index = 0; index < order.length; index += 1) {
    const left = order[index];
    const right = order[(index + 1) % order.length];
    if (left.gameId !== gameId && right.gameId !== gameId) return index + 1;
  }

  const matching = order
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.gameId === gameId);
  if (matching.length === 0) return order.length;

  let bestIndex = matching[0].index;
  let bestDistance = -1;
  for (let matchIndex = 0; matchIndex < matching.length; matchIndex += 1) {
    const current = matching[matchIndex].index;
    const next = matching[(matchIndex + 1) % matching.length].index;
    const interveningCanonicalEntries = (next - current - 1 + order.length) % order.length;
    if (interveningCanonicalEntries > bestDistance
      || (interveningCanonicalEntries === bestDistance && current < bestIndex)) {
      bestDistance = interveningCanonicalEntries;
      bestIndex = current;
    }
  }
  return bestIndex + 1;
}

export function reconcileWheelOrder(order, games, change = {}, makeEntryId = () => crypto.randomUUID()) {
  const expected = gameCounts(games);
  let next = order.map(entry => ({ ...entry }));

  if (change.type === 'landed-remove') {
    if (!Number.isInteger(change.index) || change.index < 0 || change.index >= next.length) {
      throw new RangeError(`Invalid landed Wheel index ${change.index}`);
    }
    next.splice(change.index, 1);
  }

  next = next.filter(entry => expected.has(entry.gameId));

  for (const [gameId, copies] of expected) {
    let existing = next.filter(entry => entry.gameId === gameId).length;
    for (let index = next.length - 1; index >= 0 && existing > copies; index -= 1) {
      if (next[index].gameId === gameId) {
        next.splice(index, 1);
        existing -= 1;
      }
    }
  }

  for (const [gameId, copies] of expected) {
    let existing = next.filter(entry => entry.gameId === gameId).length;
    while (existing < copies) {
      const insertionIndex = findInsertionIndex(next, gameId);
      next.splice(insertionIndex, 0, { entryId: makeEntryId(), gameId });
      existing += 1;
    }
  }

  const actual = countEntries(next);
  for (const [gameId, copies] of expected) {
    if (actual.get(gameId) !== copies) throw new Error(`Wheel reconciliation failed for game ${gameId}`);
  }
  if (next.length !== [...expected.values()].reduce((sum, copies) => sum + copies, 0)) {
    throw new Error('Wheel reconciliation produced an invalid sector count');
  }
  return next;
}

export function selectTargetSector(order, targetId, random = Math.random) {
  const matching = order
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.gameId === targetId);
  if (matching.length === 0) throw new RangeError(`Wheel has no sector for game ${targetId}`);
  return matching[Math.floor(random() * matching.length)].index;
}

export function computeTargetRotation({
  currentRotation,
  start,
  landedSectorIndex,
  sectorCount,
  durationMs,
  random = Math.random,
  reducedMotion = false
}) {
  const rotation = Number.isFinite(currentRotation) ? currentRotation : start;
  if (!Number.isFinite(rotation)) throw new TypeError('Current Wheel rotation must be finite');
  if (!Number.isInteger(sectorCount) || sectorCount <= 0) throw new RangeError('Wheel needs at least one sector');
  if (!Number.isInteger(landedSectorIndex) || landedSectorIndex < 0 || landedSectorIndex >= sectorCount) {
    throw new RangeError(`Invalid target sector ${landedSectorIndex}`);
  }

  const sectorAngle = 360 / sectorCount;
  const edgeMargin = 0.02;
  const fraction = edgeMargin + random() * (1 - edgeMargin * 2);
  const desiredAngle = normalizeAngle(90 - (landedSectorIndex + fraction) * sectorAngle);
  const clockwiseDelta = normalizeAngle(desiredAngle - normalizeAngle(rotation));
  const fullTurns = reducedMotion ? 0 : Math.max(4, Math.round((durationMs / 1000) * 1.5));
  return rotation + fullTurns * 360 + clockwiseDelta;
}

function sectorPath(cx, cy, radius, start, end) {
  const startRadians = (Math.PI / 180) * start;
  const endRadians = (Math.PI / 180) * end;
  const x1 = cx + radius * Math.cos(startRadians);
  const y1 = cy + radius * Math.sin(startRadians);
  const x2 = cx + radius * Math.cos(endRadians);
  const y2 = cy + radius * Math.sin(endRadians);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
}

function matrixAngle(transform) {
  if (!transform || transform === 'none') return 0;
  const matrix = transform.match(/^matrix\(([^)]+)\)$/);
  if (!matrix) return 0;
  const values = matrix[1].split(',').map(Number);
  return normalizeAngle(Math.atan2(values[1], values[0]) * 180 / Math.PI);
}

function reducedMotionEnabled(preference) {
  if (typeof preference === 'function') return Boolean(preference());
  if (typeof preference === 'object' && preference !== null && 'matches' in preference) return preference.matches;
  return Boolean(preference);
}

export function createWheelVisualization(elements, {
  random = Math.random,
  prefersReducedMotion = false,
  makeEntryId
} = {}) {
  let generatedId = 0;
  const createEntryId = makeEntryId ?? (() => `wheel-entry-${++generatedId}`);
  let order = [];
  let gamesById = new Map();
  let svg = elements.svg ?? null;
  let renderSignature = null;
  let lastModel = null;
  let currentRotation = 0;
  let idleAnimation = null;
  let idleBaseRotation = 0;
  let activePlay = null;
  let destroyed = false;

  function throwIfDestroyed() {
    if (destroyed) throw visualizationDestroyedError();
  }

  function initialize(games) {
    throwIfDestroyed();
    if (order.length === 0) order = createInitialWheelOrder(games, createEntryId, random);
    gamesById = new Map(games.map(game => [game.id, game]));
    return order.map(entry => ({ ...entry }));
  }

  function syncStageMetrics() {
    if (!elements.stage?.style || !elements.machine) return;
    elements.stage.style.width = '';
    elements.stage.style.height = '';
    const availableWidth = elements.machine.clientWidth;
    const availableHeight = elements.machine.clientHeight;
    if (!availableWidth) return;
    const size = Math.max(160, Math.min(availableWidth, availableHeight || availableWidth));
    elements.stage.style.width = `${size}px`;
    elements.stage.style.height = `${size}px`;
  }

  function createSvg(model) {
    const documentRef = elements.stage?.ownerDocument ?? globalThis.document;
    if (!documentRef?.createElementNS) return elements.svg ?? elements.stage?.querySelector?.('#wheelSvg') ?? null;
    const nextSvg = documentRef.createElementNS(SVG_NS, 'svg');
    nextSvg.id = 'wheelSvg';
    nextSvg.setAttribute('viewBox', '0 0 400 400');
    nextSvg.setAttribute('aria-hidden', 'true');
    nextSvg.style.transform = `rotate(${currentRotation}deg)`;

    const count = order.length;
    const center = 200;
    const radius = 196;
    const sectorAngle = 360 / count;
    const labelStart = 31;
    const labelLength = radius - labelStart - 12;
    const labelAngleWidth = 2 * (center + 72) * Math.sin((sectorAngle / 2) * Math.PI / 180);
    for (let index = 0; index < order.length; index += 1) {
      const entry = order[index];
      const game = model.games.find(candidate => candidate.id === entry.gameId);
      if (!game) continue;
      const startAngle = -90 + index * sectorAngle;
      const endAngle = startAngle + sectorAngle;
      const middleAngle = startAngle + sectorAngle / 2;
      const fontSize = Math.max(3.5, Math.min(16, labelLength / Math.max(1, game.name.length * 0.58), labelAngleWidth * 0.85));
      const textLength = Math.min(labelLength, game.name.length * fontSize * 0.58);

      const path = documentRef.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', sectorPath(center, center, radius, startAngle, endAngle));
      path.setAttribute('fill', PALETTE[game.id % PALETTE.length]);
      path.setAttribute('fill-opacity', '0.82');
      path.setAttribute('stroke', '#12161B');
      path.setAttribute('stroke-width', '1');
      nextSvg.appendChild(path);

      const group = documentRef.createElementNS(SVG_NS, 'g');
      group.setAttribute('transform', `rotate(${middleAngle} ${center} ${center})`);
      const label = documentRef.createElementNS(SVG_NS, 'text');
      label.classList.add('wheel-label');
      label.style.fontSize = `${fontSize.toFixed(2)}px`;
      label.setAttribute('x', String(center + labelStart + labelLength));
      label.setAttribute('y', String(center));
      label.setAttribute('textLength', textLength.toFixed(1));
      label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      label.textContent = game.name;
      group.appendChild(label);
      nextSvg.appendChild(group);
    }

    for (const [radius, fill, className] of [[23, null, 'wheel-hub'], [7, 'var(--amber)', null]]) {
      const circle = documentRef.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', '200');
      circle.setAttribute('cy', '200');
      circle.setAttribute('r', String(radius));
      if (fill) circle.setAttribute('fill', fill);
      if (className) circle.classList.add(className);
      nextSvg.appendChild(circle);
    }
    return nextSvg;
  }

  function startIdle() {
    if (!svg?.animate || idleAnimation || activePlay || reducedMotionEnabled(prefersReducedMotion)) return;
    idleBaseRotation = currentRotation;
    svg.style.transform = `rotate(${currentRotation}deg)`;
    idleAnimation = svg.animate([
      { transform: `rotate(${currentRotation}deg)` },
      { transform: `rotate(${currentRotation + 360}deg)` }
    ], { duration: IDLE_DURATION_MS, iterations: Infinity, easing: 'linear' });
  }

  function stopIdleAtCurrentAngle() {
    if (!idleAnimation) return currentRotation;
    let observed = normalizeAngle(currentRotation);
    if (typeof globalThis.getComputedStyle === 'function' && svg) {
      observed = matrixAngle(globalThis.getComputedStyle(svg).transform);
    }
    const elapsed = Number(idleAnimation.currentTime) || 0;
    const completedTurns = Math.floor(elapsed / IDLE_DURATION_MS);
    const withinTurn = normalizeAngle(observed - normalizeAngle(idleBaseRotation));
    currentRotation = idleBaseRotation + completedTurns * 360 + withinTurn;
    idleAnimation.cancel();
    idleAnimation = null;
    if (svg?.style) svg.style.transform = `rotate(${currentRotation}deg)`;
    return currentRotation;
  }

  function render(model) {
    throwIfDestroyed();
    lastModel = model;
    gamesById = new Map(model.games.map(game => [game.id, game]));
    if (order.length === 0 && model.games.length > 0) initialize(model.games);
    const signature = order.map(entry => `${entry.entryId}:${entry.gameId}`).join('|')
      + `/${model.games.map(game => `${game.id}:${game.name}`).join('|')}`;
    if (signature !== renderSignature) {
      stopIdleAtCurrentAngle();
      syncStageMetrics();
      const nextSvg = elements.svg ?? createSvg(model);
      if (nextSvg && nextSvg !== elements.svg) elements.stage.replaceChildren(nextSvg);
      svg = nextSvg;
      renderSignature = signature;
    }
    startIdle();
  }

  function cancelActivePlay() {
    if (!activePlay) return;
    const playState = activePlay;
    activePlay = null;
    playState.removeAbortListener?.();
    if (!playState.animationCancelled) {
      playState.animationCancelled = true;
      playState.animation.cancel();
    }
    elements.machine?.classList?.remove('spinning');
    playState.reject(abortError());
  }

  async function play({ target, durationMs, signal }) {
    throwIfDestroyed();
    if (activePlay) throw new Error('WHEEL_PLAY_ACTIVE');
    if (signal?.aborted) throw abortError();
    if (order.length === 0) throw new RangeError('Wheel has no sectors');
    svg ??= elements.stage?.querySelector?.('#wheelSvg') ?? null;
    if (!svg?.animate) throw new Error('Wheel SVG is not rendered');

    const landedSectorIndex = selectTargetSector(order, target.id, random);
    const start = stopIdleAtCurrentAngle();
    const reducedMotion = reducedMotionEnabled(prefersReducedMotion);
    const plannedDuration = reducedMotion
      ? Math.min(durationMs, REDUCED_MOTION_DURATION_MS)
      : durationMs;
    const end = computeTargetRotation({
      currentRotation: start,
      landedSectorIndex,
      sectorCount: order.length,
      durationMs: plannedDuration,
      random,
      reducedMotion
    });
    const progressFrames = reducedMotion
      ? [{ offset: 0, progress: 0 }, { offset: 1, progress: 1 }]
      : createProgressKeyframes({ durationMs: plannedDuration }).keyframes;
    const rotationFrames = progressFrames.map(({ offset, progress }) => ({
      transform: `rotate(${start + (end - start) * progress}deg)`,
      offset,
      easing: 'linear'
    }));
    const animation = svg.animate(rotationFrames, {
      duration: plannedDuration,
      fill: 'forwards',
      easing: 'linear'
    });
    elements.machine?.classList?.add('spinning');

    await new Promise((resolve, reject) => {
      const handleAbort = () => cancelActivePlay();
      if (signal) signal.addEventListener('abort', handleAbort, { once: true });
      activePlay = {
        animation,
        animationCancelled: false,
        reject,
        removeAbortListener: signal
          ? () => signal.removeEventListener('abort', handleAbort)
          : null
      };
      animation.finished.then(() => {
        if (!activePlay || activePlay.animation !== animation) return;
        activePlay.removeAbortListener?.();
        activePlay = null;
        animation.commitStyles?.();
        currentRotation = end;
        svg.style.transform = `rotate(${end}deg)`;
        elements.machine?.classList?.remove('spinning');
        resolve();
      }, error => {
        if (!activePlay || activePlay.animation !== animation) return;
        activePlay.removeAbortListener?.();
        activePlay = null;
        elements.machine?.classList?.remove('spinning');
        reject(error?.name === 'AbortError' ? abortError() : error);
      });
    });

    return { kind: 'wheel-complete', targetId: target.id, landedSectorIndex };
  }

  function cancel() {
    if (destroyed) return;
    cancelActivePlay();
    if (idleAnimation) {
      idleAnimation.cancel();
      idleAnimation = null;
    }
  }

  function reconcile(games, change) {
    throwIfDestroyed();
    order = reconcileWheelOrder(order, games, change, createEntryId);
    gamesById = new Map(games.map(game => [game.id, game]));
    renderSignature = null;
    return order.map(entry => ({ ...entry }));
  }

  function shuffleOrder() {
    throwIfDestroyed();
    stopIdleAtCurrentAngle();
    order = shuffle(order, random);
    renderSignature = null;
    if (lastModel) render(lastModel);
    return order.map(entry => ({ ...entry }));
  }

  function destroy() {
    if (destroyed) return;
    cancel();
    svg?.getAnimations?.().forEach(animation => animation.cancel());
    destroyed = true;
    order = [];
    gamesById.clear();
    svg = null;
    lastModel = null;
  }

  return {
    initialize,
    render,
    play,
    cancel,
    destroy,
    reconcile,
    shuffle: shuffleOrder
  };
}
