import { colorForGame, formatSavedAt, hexToRgba, normalizeName } from '../shared/presentation.js';

function gamesWord(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'ігор';
  if (last === 1) return 'гра';
  if (last >= 2 && last <= 4) return 'гри';
  return 'ігор';
}

export function createGameListView(elements, handlers) {
  let catalogImages = new Map();

  function catalogKey(name) {
    return normalizeName(name).toLocaleLowerCase('uk');
  }

  function gameInitial(name) {
    return [...normalizeName(name)][0]?.toLocaleUpperCase('uk') ?? '?';
  }

  function createCover(game, color) {
    const cover = document.createElement('div');
    cover.className = 'game-card-cover';
    cover.style.setProperty('--cover-color', color);
    const fallback = document.createElement('span');
    fallback.className = 'game-card-fallback';
    fallback.textContent = gameInitial(game.name);
    const imageUrl = catalogImages.get(catalogKey(game.name));
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      fallback.hidden = true;
      image.addEventListener('error', () => { image.remove(); fallback.hidden = false; });
      cover.append(image, fallback);
    } else {
      cover.append(fallback);
    }
    return cover;
  }

  function render(state, history) {
    elements.empty.hidden = state.games.length > 0;
    elements.listHead.hidden = state.games.length === 0;
    elements.lock.disabled = state.games.length < 2;
    elements.startHint.textContent = state.games.length === 0
      ? 'Додай щонайменше 2 варіанти'
      : state.games.length === 1
        ? 'Додай ще 1 варіант'
        : 'Усе готово до скаму';
    elements.tickets.replaceChildren(...state.games.map((game, index) => {
      const card = document.createElement('div');
      card.className = 'ticket'; card.dataset.id = game.id;
      const color = colorForGame(game);
      card.style.setProperty('--ticket-color', color);
      card.style.borderLeft = `3px solid ${color}`;
      card.style.background = `linear-gradient(90deg, ${hexToRgba(color, .1)}, transparent 60%), var(--panel)`;
      card.innerHTML = `<div class="tnum"> №${String(index + 1).padStart(2, '0')}</div><div class="tname"></div><div class="trow"><div class="copies-stepper"><button class="step-btn minus-btn" data-action="decrease" type="button">−</button><span class="copies-badge">× ${game.copies}</span><button class="step-btn plus-btn" data-action="increase" type="button">+</button></div><button class="del-btn" data-action="remove">видалити</button></div>`;
      card.prepend(createCover(game, color));
      card.querySelector('.tname').textContent = game.name;
      card.querySelector('.minus-btn').setAttribute('aria-label', `Зменшити кількість копій ${game.name}`);
      card.querySelector('.plus-btn').setAttribute('aria-label', `Збільшити кількість копій ${game.name}`);
      const removeButton = card.querySelector('.del-btn');
      removeButton.type = 'button';
      removeButton.setAttribute('aria-label', `Видалити ${game.name}`);
      card.querySelector('.tnum').style.color = color;
      card.querySelector('.copies-badge').style.cssText = `border-color:${hexToRgba(color,.55)};color:${color}`;
      return card;
    }));
    elements.historyEmpty.hidden = history.length > 0;
    elements.historyList.replaceChildren(...history.map(entry => {
      const totalCopies = entry.games.reduce((total, game) => total + game.copies, 0);
      const item = document.createElement('article'); item.className = 'history-item'; item.dataset.id = entry.id;
      const top = document.createElement('div'); top.className = 'history-item-top';
      const date = document.createElement('time'); date.className = 'h-date'; date.dateTime = entry.savedAt; date.textContent = formatSavedAt(entry.savedAt);
      const summary = document.createElement('span'); summary.className = 'history-summary'; summary.textContent = `${entry.games.length} ${gamesWord(entry.games.length)} · ${totalCopies} коп.`;
      top.append(date, summary);
      const names = document.createElement('p'); names.className = 'h-names'; names.textContent = entry.games.map(game => game.name + (game.copies > 1 ? ` ×${game.copies}` : '')).join(', ');
      const button = document.createElement('button'); button.className = 'btn-ghost history-restore'; button.type = 'button'; button.dataset.action = 'copy-history'; button.innerHTML = 'Відновити список <span aria-hidden="true">→</span>';
      button.setAttribute('aria-label', `Відновити список від ${formatSavedAt(entry.savedAt)}`);
      item.append(top, names, button); return item;
    }));
  }
  function click(event) {
    const action = event.target.closest('[data-action]'); if (!action) return;
    const id = Number(action.closest('[data-id]').dataset.id);
    ({ remove: handlers.onRemove, decrease: () => handlers.onCopyDelta(id, -1), increase: () => handlers.onCopyDelta(id, 1), 'copy-history': handlers.onCopyHistory }[action.dataset.action])?.(id);
  }
  elements.tickets.addEventListener('click', click); elements.historyList.addEventListener('click', click);
  return {
    render,
    setCatalog(games) {
      catalogImages = new Map((Array.isArray(games) ? games : [])
        .filter(game => game?.title && game?.image)
        .map(game => [catalogKey(game.title), game.image]));
    },
    destroy() { elements.tickets.removeEventListener('click', click); elements.historyList.removeEventListener('click', click); }
  };
}
