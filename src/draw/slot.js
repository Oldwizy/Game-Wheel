import { shuffleNoAdjacent } from '../core/random.js';
import { createProgressKeyframes, velocityAt } from './motion-profile.js';

export { velocityAt } from './motion-profile.js';

const DEFAULT_ROW_HEIGHT = 56;
// Та сама швидкість та щільність кадрів, що в каруселі «Таємно»:
// швидкий старт, довга прокрутка й виразне плавне гальмування.
const TRAVEL_SPEED_PX_PER_SECOND = 900;
const REDUCED_MOTION_DURATION_MS = 120;
const PALETTE = ['#E85D5D', '#4ECDC4', '#FFB347', '#7C8CFF', '#C67CFF', '#69B56B', '#5DC8E8', '#FF8FB1', '#F2C14E', '#F2955A'];

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function destroyedError() {
  const error = new Error('Slot visualization has been destroyed');
  error.code = 'VISUALIZATION_DESTROYED';
  return error;
}

function reducedMotionEnabled(preference) {
  if (typeof preference === 'function') return Boolean(preference());
  if (typeof preference === 'object' && preference !== null && 'matches' in preference) return preference.matches;
  return Boolean(preference);
}

function buildSequence(pool, length, random) {
  const result = [];
  while (result.length < length) {
    const previousId = result.at(-1)?.id;
    const chunk = shuffleNoAdjacent(pool, game => game.id, { avoidFirstKey: previousId }, random);
    result.push(...chunk);
  }
  return result.slice(0, length);
}

function moveNonTargetBesideTarget(items, targetIndex, neighborIndex, targetId) {
  if (neighborIndex < 0 || neighborIndex >= items.length || items[neighborIndex].id !== targetId) return;
  const replacementIndex = items.findIndex((item, index) => (
    item.id !== targetId
    && index !== targetIndex
    && index !== targetIndex - 1
    && index !== targetIndex + 1
  ));
  if (replacementIndex >= 0) {
    [items[neighborIndex], items[replacementIndex]] = [items[replacementIndex], items[neighborIndex]];
  }
}

export function buildReelModel({
  games,
  targetId,
  visibleRows,
  durationMs,
  random = Math.random,
  rowHeight = DEFAULT_ROW_HEIGHT
}) {
  const target = games.find(game => game.id === targetId);
  if (!target) throw new RangeError(`Unknown Slot target ${targetId}`);
  const pool = games.flatMap(game => Array.from({ length: game.copies }, () => game));
  if (pool.length === 0) throw new RangeError('Slot has no tickets');

  const centerRow = Math.floor(visibleRows / 2);
  const travelRows = Math.max(
    12,
    Math.ceil((TRAVEL_SPEED_PX_PER_SECOND * durationMs / 1000) / rowHeight)
  );
  const targetIndex = travelRows + centerRow;
  const trailingRows = Math.max(centerRow, 2);
  const items = buildSequence(pool, targetIndex + trailingRows + 1, random);
  const existingTargetIndex = items.findIndex((item, index) => item.id === targetId && index !== targetIndex);
  if (items[targetIndex].id !== targetId && existingTargetIndex >= 0) {
    [items[targetIndex], items[existingTargetIndex]] = [items[existingTargetIndex], items[targetIndex]];
  } else {
    items[targetIndex] = target;
  }
  moveNonTargetBesideTarget(items, targetIndex, targetIndex - 1, targetId);
  moveNonTargetBesideTarget(items, targetIndex, targetIndex + 1, targetId);

  return { items, targetIndex, centerRow, travelRows, rowHeight };
}

export function createMotionKeyframes({
  startTranslateY = 0,
  finalTranslateY,
  targetIndex,
  durationMs,
  samples = 140,
  profile
}) {
  if (!Number.isFinite(finalTranslateY)) throw new TypeError('Final Slot translation must be finite');
  const progressMotion = createProgressKeyframes({ durationMs, samples, profile });
  const keyframes = progressMotion.keyframes.map(({ progress, offset }) => {
    const translateY = offset === 1
      ? finalTranslateY
      : startTranslateY + (finalTranslateY - startTranslateY) * progress;
    return {
      transform: `translateY(${translateY}px)`,
      offset,
      easing: 'linear'
    };
  });
  return { keyframes, finalTranslateY, targetIndex, profile: progressMotion.profile };
}

export function createSlotVisualization(elements, {
  random = Math.random,
  prefersReducedMotion = false
} = {}) {
  let destroyed = false;
  let activePlay = null;
  let lastGames = [];

  function throwIfDestroyed() {
    if (destroyed) throw destroyedError();
  }

  function rowMetrics() {
    const rowHeight = elements.rowHeight ?? DEFAULT_ROW_HEIGHT;
    if (elements.window?.style) {
      elements.window.style.flex = '1 1 auto';
      elements.window.style.height = '';
    }
    const naturalHeight = elements.window?.clientHeight || rowHeight * 3;
    let visibleRows = Math.max(3, Math.floor(naturalHeight / rowHeight));
    if (visibleRows % 2 === 0) visibleRows -= 1;
    visibleRows = Math.max(3, visibleRows);
    if (elements.window?.style) {
      elements.window.style.flex = '0 0 auto';
      elements.window.style.height = `${visibleRows * rowHeight}px`;
    }
    return { rowHeight, visibleRows };
  }

  function createItem(game, centered = false) {
    const documentRef = elements.strip?.ownerDocument ?? globalThis.document;
    if (!documentRef?.createElement) return null;
    const item = documentRef.createElement('div');
    item.className = `slot-item${centered ? ' slot-item-center' : ''}`;
    item.dataset.gameId = String(game.id);
    const name = documentRef.createElement('span');
    name.style.color = centered ? '' : PALETTE[game.id % PALETTE.length];
    name.textContent = game.name;
    item.appendChild(name);
    return item;
  }

  function replaceItems(items, centerIndex = -1) {
    if (!elements.strip?.replaceChildren) return;
    const nodes = items.map((game, index) => createItem(game, index === centerIndex)).filter(Boolean);
    elements.strip.replaceChildren(...nodes);
  }

  function render(model) {
    throwIfDestroyed();
    lastGames = [...model.games];
    elements.machine?.classList?.remove('spinning', 'slot-landed');
    const { rowHeight, visibleRows } = rowMetrics();
    if (model.games.length === 0) {
      elements.strip?.replaceChildren?.();
      return;
    }
    const pool = model.games.flatMap(game => Array.from({ length: game.copies }, () => game));
    const items = buildSequence(pool, Math.max(visibleRows, pool.length), random);
    const centerIndex = Math.min(Math.floor(visibleRows / 2), items.length - 1);
    replaceItems(items, centerIndex);
    const translateY = (visibleRows * rowHeight / 2 - rowHeight / 2) - centerIndex * rowHeight;
    elements.strip.style.transform = `translateY(${translateY}px)`;
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

  async function play({ target, games = lastGames, durationMs, signal }) {
    throwIfDestroyed();
    if (activePlay) throw new Error('SLOT_PLAY_ACTIVE');
    if (signal?.aborted) throw abortError();
    if (!elements.strip?.animate) throw new Error('Slot strip is not rendered');

    const { rowHeight, visibleRows } = rowMetrics();
    const reel = buildReelModel({
      games,
      targetId: target.id,
      visibleRows,
      durationMs,
      random,
      rowHeight
    });
    replaceItems(reel.items);
    elements.strip.querySelectorAll?.('.slot-item-center').forEach(item => item.classList.remove('slot-item-center'));
    elements.strip.style.transform = 'translateY(0px)';
    const finalTranslateY = (visibleRows * rowHeight / 2 - rowHeight / 2) - reel.targetIndex * rowHeight;
    const motion = createMotionKeyframes({
      startTranslateY: 0,
      finalTranslateY,
      targetIndex: reel.targetIndex,
      durationMs
    });
    const reducedMotion = reducedMotionEnabled(prefersReducedMotion);
    const plannedDuration = reducedMotion
      ? Math.min(durationMs, REDUCED_MOTION_DURATION_MS)
      : durationMs;
    const animation = elements.strip.animate(motion.keyframes, {
      duration: plannedDuration,
      fill: 'forwards',
      easing: 'linear'
    });
    elements.machine?.classList?.remove('slot-landed');
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
        elements.strip.style.transform = `translateY(${motion.finalTranslateY}px)`;
        animation.commitStyles?.();
        animation.cancel();
        elements.strip.children[reel.targetIndex]?.classList?.add('slot-item-center');
        elements.machine?.classList?.remove('spinning');
        elements.machine?.classList?.add('slot-landed');
        resolve();
      }, error => {
        if (!activePlay || activePlay.animation !== animation) return;
        activePlay.removeAbortListener?.();
        activePlay = null;
        elements.machine?.classList?.remove('spinning');
        reject(error?.name === 'AbortError' ? abortError() : error);
      });
    });

    return { kind: 'slot-complete', targetId: target.id };
  }

  function cancel() {
    if (destroyed) return;
    cancelActivePlay();
  }

  function destroy() {
    if (destroyed) return;
    cancel();
    elements.strip?.getAnimations?.().forEach(animation => animation.cancel());
    destroyed = true;
    lastGames = [];
  }

  return { render, play, cancel, destroy };
}
