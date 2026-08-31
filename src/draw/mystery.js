import { shuffleNoAdjacent } from '../core/random.js';
import { createProgressKeyframes } from './motion-profile.js';
import { normalizeName } from '../shared/presentation.js';
import { UKRAINIAN_GAME_ALIASES } from '../data/game-ukrainian-aliases.js';

const CARD_WIDTH = 148;
const TRAVEL_SPEED_PX_PER_SECOND = 900;
const REDUCED_MOTION_DURATION_MS = 120;

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function reducedMotionEnabled(preference) {
  if (typeof preference === 'function') return Boolean(preference());
  if (typeof preference === 'object' && preference !== null && 'matches' in preference) return preference.matches;
  return Boolean(preference);
}

function buildSequence(pool, length, random) {
  const items = [];
  while (items.length < length) {
    const previousId = items.at(-1)?.id;
    items.push(...shuffleNoAdjacent(pool, game => game.id, { avoidFirstKey: previousId }, random));
  }
  return items.slice(0, length);
}

export function buildMysteryReel({ games, targetId, viewportWidth, durationMs, random = Math.random }) {
  const target = games.find(game => game.id === targetId);
  if (!target) throw new RangeError(`Unknown Mystery target ${targetId}`);
  const pool = games.flatMap(game => Array.from({ length: game.copies }, () => game));
  if (pool.length === 0) throw new RangeError('Mystery reel has no tickets');

  const visibleCards = Math.max(3, Math.ceil(viewportWidth / CARD_WIDTH));
  const travelCards = Math.max(16, Math.ceil((TRAVEL_SPEED_PX_PER_SECOND * durationMs / 1000) / CARD_WIDTH));
  const targetIndex = travelCards + Math.floor(visibleCards / 2);
  const items = buildSequence(pool, targetIndex + visibleCards + 2, random);
  const existingTarget = items.findIndex((game, index) => game.id === targetId && index !== targetIndex);
  if (existingTarget >= 0) [items[targetIndex], items[existingTarget]] = [items[existingTarget], items[targetIndex]];
  else items[targetIndex] = target;

  return { items, targetIndex, cardWidth: CARD_WIDTH };
}

export function createMysteryVisualization(elements, {
  random = Math.random,
  prefersReducedMotion = false
} = {}) {
  let destroyed = false;
  let activePlay = null;
  let lastGames = [];
  let catalogImages = new Map();
  let catalogEntries = [];

  const catalogKey = name => normalizeName(name).toLocaleLowerCase('uk');
  const gameInitial = name => [...normalizeName(name)][0]?.toLocaleUpperCase('uk') ?? '?';
  function imageForGame(name) {
    const key = catalogKey(name);
    return catalogImages.get(key)
      ?? catalogEntries.find(entry => entry.key.includes(key) || key.includes(entry.key))?.image;
  }

  function replaceItems(items) {
    const documentRef = elements.strip?.ownerDocument ?? globalThis.document;
    if (!documentRef?.createElement || !elements.strip?.replaceChildren) return;
    const nodes = items.map(game => {
      const card = documentRef.createElement('div');
      card.className = 'mystery-folder';
      card.dataset.gameId = String(game.id);
      card.setAttribute('aria-label', 'Прихована гра');
      const cover = documentRef.createElement('span');
      cover.className = 'mystery-cover';
      const fallback = documentRef.createElement('span');
      fallback.className = 'mystery-cover-fallback';
      fallback.textContent = gameInitial(game.name);
      const imageUrl = imageForGame(game.name);
      if (imageUrl) {
        const image = documentRef.createElement('img');
        image.src = imageUrl;
        image.alt = '';
        image.decoding = 'async';
        image.addEventListener('error', () => { image.remove(); fallback.hidden = false; });
        fallback.hidden = true;
        cover.append(image, fallback);
      } else {
        cover.append(fallback);
      }
      card.append(cover);
      return card;
    });
    elements.strip.replaceChildren(...nodes);
  }

  function render({ games }) {
    if (destroyed) return;
    lastGames = [...games];
    elements.machine?.classList?.remove('spinning', 'mystery-landed');
    elements.result.textContent = '';
    if (games.length === 0) {
      elements.strip?.replaceChildren?.();
      return;
    }
    const pool = games.flatMap(game => Array.from({ length: game.copies }, () => game));
    const viewportWidth = elements.machine?.clientWidth || CARD_WIDTH * 4;
    replaceItems(buildSequence(pool, Math.max(5, Math.ceil(viewportWidth / CARD_WIDTH) + 2), random));
    elements.strip.style.transform = 'translateX(0px)';
  }

  function cancelActivePlay() {
    if (!activePlay) return;
    const current = activePlay;
    activePlay = null;
    current.removeAbortListener?.();
    current.animation.cancel();
    elements.machine?.classList?.remove('spinning');
    current.reject(abortError());
  }

  async function play({ target, games = lastGames, durationMs, signal }) {
    if (destroyed) throw new Error('Mystery visualization has been destroyed');
    if (activePlay) throw new Error('MYSTERY_PLAY_ACTIVE');
    if (signal?.aborted) throw abortError();

    const viewportWidth = elements.machine?.clientWidth || CARD_WIDTH * 4;
    const reel = buildMysteryReel({ games, targetId: target.id, viewportWidth, durationMs, random });
    replaceItems(reel.items);
    elements.result.textContent = '';
    elements.strip.style.transform = 'translateX(0px)';
    const finalTranslateX = viewportWidth / 2 - reel.cardWidth / 2 - reel.targetIndex * reel.cardWidth;
    const frames = createProgressKeyframes({ durationMs, samples: 140 }).keyframes.map(({ progress, offset }) => ({
      transform: `translateX(${finalTranslateX * progress}px)`, offset, easing: 'linear'
    }));
    const animation = elements.strip.animate(frames, {
      duration: reducedMotionEnabled(prefersReducedMotion) ? Math.min(durationMs, REDUCED_MOTION_DURATION_MS) : durationMs,
      fill: 'forwards',
      easing: 'linear'
    });
    elements.machine?.classList?.add('spinning');

    await new Promise((resolve, reject) => {
      const handleAbort = () => cancelActivePlay();
      signal?.addEventListener('abort', handleAbort, { once: true });
      activePlay = {
        animation,
        reject,
        removeAbortListener: signal ? () => signal.removeEventListener('abort', handleAbort) : null
      };
      animation.finished.then(() => {
        if (!activePlay || activePlay.animation !== animation) return;
        activePlay.removeAbortListener?.();
        activePlay = null;
        elements.strip.style.transform = `translateX(${finalTranslateX}px)`;
        animation.commitStyles?.();
        animation.cancel();
        const selected = elements.strip.children[reel.targetIndex];
        selected?.classList?.add('mystery-folder-selected');
        selected?.setAttribute?.('aria-label', `Відкрито: ${target.name}`);
        elements.result.textContent = target.name;
        elements.machine?.classList?.remove('spinning');
        elements.machine?.classList?.add('mystery-landed');
        resolve();
      }, error => {
        if (!activePlay || activePlay.animation !== animation) return;
        activePlay.removeAbortListener?.();
        activePlay = null;
        elements.machine?.classList?.remove('spinning');
        reject(error?.name === 'AbortError' ? abortError() : error);
      });
    });
    return { kind: 'mystery-complete', targetId: target.id };
  }

  function cancel() { if (!destroyed) cancelActivePlay(); }
  function destroy() {
    if (destroyed) return;
    cancel();
    elements.strip?.getAnimations?.().forEach(animation => animation.cancel());
    destroyed = true;
    lastGames = [];
  }

  return {
    render,
    play,
    cancel,
    setCatalog(games) {
      catalogImages = new Map();
      catalogEntries = (Array.isArray(games) ? games : [])
        .filter(game => game?.title && game?.image)
        .map(game => ({ key: catalogKey(game.title), image: game.image }));
      (Array.isArray(games) ? games : [])
        .filter(game => game?.title && game?.image)
        .forEach(game => {
          catalogImages.set(catalogKey(game.title), game.image);
          (UKRAINIAN_GAME_ALIASES[game.title] ?? []).forEach(alias => {
            catalogImages.set(catalogKey(alias), game.image);
          });
        });
    },
    destroy
  };
}
