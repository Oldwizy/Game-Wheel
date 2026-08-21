import { colorForGame, formatSavedAt, hexToRgba } from '../shared/presentation.js';

function gamesWord(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'ігор';
  if (last === 1) return 'гра';
  if (last >= 2 && last <= 4) return 'гри';
  return 'ігор';
}

export function createGameListView(elements, handlers) {
  function render(state, history) {
    elements.empty.style.display = state.games.length ? 'none' : 'block';
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
      card.style.borderLeft = `3px solid ${color}`;
      card.style.background = `linear-gradient(90deg, ${hexToRgba(color, .1)}, transparent 60%), var(--panel)`;
      card.innerHTML = `<div class="tnum"> №${String(index + 1).padStart(2, '0')}</div><div class="tname"></div><div class="trow"><div class="copies-stepper"><button class="step-btn minus-btn" data-action="decrease" type="button">−</button><span class="copies-badge">× ${game.copies}</span><button class="step-btn plus-btn" data-action="increase" type="button">+</button></div><button class="del-btn" data-action="remove">видалити</button></div>`;
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
    elements.historyBlock.style.display = history.length ? 'block' : 'none';
    elements.historyList.replaceChildren(...history.map(entry => {
      const item = document.createElement('div'); item.className = 'history-item'; item.dataset.id = entry.id;
      const date = document.createElement('div'); date.className = 'h-date'; date.textContent = `${formatSavedAt(entry.savedAt)} · ${entry.games.length} ${gamesWord(entry.games.length)}`;
      const names = document.createElement('div'); names.className = 'h-names'; names.textContent = entry.games.map(game => game.name + (game.copies > 1 ? ` ×${game.copies}` : '')).join(', ');
      const button = document.createElement('button'); button.className = 'btn-ghost'; button.type = 'button'; button.dataset.action = 'load-history'; button.textContent = 'Завантажити';
      item.append(date, names, button); return item;
    }));
  }
  function click(event) {
    const action = event.target.closest('[data-action]'); if (!action) return;
    const id = Number(action.closest('[data-id]').dataset.id);
    ({ remove: handlers.onRemove, decrease: () => handlers.onCopyDelta(id, -1), increase: () => handlers.onCopyDelta(id, 1), 'load-history': handlers.onLoadHistory }[action.dataset.action])?.(id);
  }
  elements.tickets.addEventListener('click', click); elements.historyList.addEventListener('click', click);
  return { render, destroy() { elements.tickets.removeEventListener('click', click); elements.historyList.removeEventListener('click', click); } };
}
