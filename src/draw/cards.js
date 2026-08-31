import { normalizeName } from '../shared/presentation.js';
import { UKRAINIAN_GAME_ALIASES } from '../data/game-ukrainian-aliases.js';
import { shuffle } from '../core/random.js';

const PREVIEW_MS = 1250;

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function reducedMotionEnabled(preference) {
  return typeof preference === 'object' && preference !== null && 'matches' in preference
    ? preference.matches
    : Boolean(preference);
}

export function createCardsVisualization(elements, { random = Math.random, prefersReducedMotion = false } = {}) {
  let destroyed = false;
  let activePlay = null;
  let lastGames = [];
  let catalogImages = new Map();
  let catalogEntries = [];
  let previewTimer = null;

  const catalogKey = name => normalizeName(name).toLocaleLowerCase('uk');
  const imageForGame = name => {
    const key = catalogKey(name);
    return catalogImages.get(key) ?? catalogEntries.find(entry => entry.key.includes(key) || key.includes(entry.key))?.image;
  };

  function hidePreview(card) {
    card?.classList.remove('is-previewed');
  }

  function preview(card, temporary = false) {
    if (!card || card.classList.contains('is-selected')) return;
    hidePreview(elements.grid.querySelector('.is-previewed'));
    card.classList.add('is-previewed');
    if (temporary) {
      card.classList.add('is-viewed');
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => hidePreview(card), reducedMotionEnabled(prefersReducedMotion) ? 0 : PREVIEW_MS);
    }
  }

  function createCard(game, copyIndex) {
    const documentRef = elements.grid.ownerDocument;
    const card = documentRef.createElement('button');
    card.type = 'button';
    card.className = 'game-card';
    card.dataset.gameId = String(game.id);
    card.dataset.copyIndex = String(copyIndex);
    card.setAttribute('aria-label', 'Закрита картка гри. Натисніть, щоб тимчасово переглянути.');
    const inner = documentRef.createElement('span');
    inner.className = 'game-card-inner';
    const back = documentRef.createElement('span');
    back.className = 'game-card-back';
    back.setAttribute('aria-hidden', 'true');
    back.textContent = '?';
    const face = documentRef.createElement('span');
    face.className = 'game-card-face';
    const imageUrl = imageForGame(game.name);
    if (imageUrl) {
      const image = documentRef.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove());
      face.append(image);
    }
    const title = documentRef.createElement('span');
    title.className = 'game-card-title';
    title.textContent = game.name;
    face.append(title);
    inner.append(back, face);
    card.append(inner);
    const resetTilt = () => {
      card.classList.remove('is-hovered');
      card.style.removeProperty('--card-tilt-x');
      card.style.removeProperty('--card-tilt-y');
    };
    card.addEventListener('pointerenter', () => card.classList.add('is-hovered'));
    card.addEventListener('pointermove', event => {
      const bounds = card.getBoundingClientRect();
      const tiltX = ((event.clientY - bounds.top) / bounds.height - .5) * -10;
      const tiltY = ((event.clientX - bounds.left) / bounds.width - .5) * 10;
      card.style.setProperty('--card-tilt-x', `${tiltX.toFixed(2)}deg`);
      card.style.setProperty('--card-tilt-y', `${tiltY.toFixed(2)}deg`);
    });
    card.addEventListener('pointerleave', resetTilt);
    card.addEventListener('focus', () => card.classList.add('is-hovered'));
    card.addEventListener('blur', resetTilt);
    card.addEventListener('click', () => preview(card, true));
    return card;
  }

  function replaceCards(games) {
    const pool = games.flatMap(game => Array.from({ length: game.copies }, (_, copyIndex) => ({ game, copyIndex })));
    const cards = shuffle(pool, random).map(({ game, copyIndex }) => createCard(game, copyIndex));
    elements.grid.replaceChildren(...cards);
  }

  function render({ games }) {
    if (destroyed) return;
    lastGames = [...games];
    clearTimeout(previewTimer);
    elements.result.textContent = '';
    elements.machine.classList.remove('spinning', 'cards-landed');
    replaceCards(games);
  }

  async function play({ target, games = lastGames, durationMs, signal }) {
    if (destroyed) throw new Error('Cards visualization has been destroyed');
    if (activePlay) throw new Error('CARDS_PLAY_ACTIVE');
    if (signal?.aborted) throw abortError();
    render({ games });
    const candidates = [...elements.grid.querySelectorAll(`[data-game-id="${target.id}"]`)];
    const selected = candidates[Math.floor(random() * candidates.length)];
    if (!selected) throw new RangeError(`Unknown cards target ${target.id}`);
    const delay = reducedMotionEnabled(prefersReducedMotion) ? 80 : Math.min(durationMs, 900);
    elements.machine.classList.add('spinning');
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); activePlay = null; reject(abortError()); };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, delay);
      signal?.addEventListener('abort', abort, { once: true });
      activePlay = { abort, timer, signal };
    });
    if (signal?.aborted) throw abortError();
    activePlay = null;
    selected.classList.add('is-selected', 'is-previewed');
    selected.setAttribute('aria-label', `Обрана картка: ${target.name}`);
    elements.result.textContent = target.name;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      hidePreview(selected);
      elements.result.textContent = '';
    }, reducedMotionEnabled(prefersReducedMotion) ? 0 : PREVIEW_MS);
    elements.machine.classList.remove('spinning');
    elements.machine.classList.add('cards-landed');
    return { kind: 'cards-complete', targetId: target.id };
  }

  function cancel() {
    if (!activePlay) return;
    clearTimeout(activePlay.timer);
    activePlay.signal?.removeEventListener?.('abort', activePlay.abort);
    activePlay = null;
    elements.machine.classList.remove('spinning');
  }

  return {
    render,
    play,
    cancel,
    setCatalog(games) {
      catalogImages = new Map();
      catalogEntries = (Array.isArray(games) ? games : []).filter(game => game?.title && game?.image)
        .map(game => ({ title: game.title, key: catalogKey(game.title), image: game.image }));
      catalogEntries.forEach(game => {
        catalogImages.set(game.key, game.image);
        (UKRAINIAN_GAME_ALIASES[game.title] ?? []).forEach(alias => catalogImages.set(catalogKey(alias), game.image));
      });
    },
    destroy() {
      clearTimeout(previewTimer);
      cancel();
      destroyed = true;
      lastGames = [];
    }
  };
}
