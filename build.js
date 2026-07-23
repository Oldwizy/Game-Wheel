// build.js — логіка сторінки "Список ігор" (index.html).
// Формування списку учасників розіграшу, збереження в localStorage і перехід
// до draw.html, коли список готовий.
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const gameInput = $('#gameInput');
  const copiesInput = $('#copiesInput');
  const addBtn = $('#addBtn');
  const clearBtn = $('#clearBtn');
  const lockBtn = $('#lockBtn');
  const resetAllBtn = $('#resetAllBtn');
  const ticketsEl = $('#tickets');
  const emptyNote = $('#emptyNote');
  const historyBlock = $('#historyBlock');
  const historyList = $('#historyList');

  // Повний стан застосунку (список ігор + налаштування раунду й лог, які тут
  // не редагуються, але мають зберегтися незмінними при повторному записі).
  let state = Common.loadState();

  function persist() { Common.saveState(state); }

  function findByName(name) {
    const n = Common.normalize(name).toLowerCase();
    return state.games.find(g => g.name.toLowerCase() === n);
  }

  function addGame() {
    // Додає гру або збільшує кількість її копій, якщо така назва вже існує.
    const name = Common.normalize(gameInput.value);
    let copies = parseInt(copiesInput.value, 10);
    if (!name) { gameInput.focus(); return; }
    if (!Number.isFinite(copies) || copies < 1) copies = 1;

    const existing = findByName(name);
    if (existing) {
      existing.copies += copies;
    } else {
      state.games.push({ id: state.nextId++, name, copies });
    }
    gameInput.value = '';
    copiesInput.value = '1';
    gameInput.focus();
    renderBuildList();
    persist();
  }

  function removeGame(id) {
    state.games = state.games.filter(g => g.id !== id);
    renderBuildList();
    persist();
  }

  function changeCopies(id, delta) {
    const g = state.games.find(x => x.id === id);
    if (!g) return;
    const next = g.copies + delta;
    if (next < 1) return; // видалення гри відбувається через кнопку "видалити"
    g.copies = next;
    renderBuildList();
    persist();
  }

  function applyCardColor(card, game) {
    const color = Common.colorForGame(game);
    card.style.borderLeft = `3px solid ${color}`;
    card.style.background = `linear-gradient(90deg, ${Common.hexToRgba(color, 0.10)}, transparent 60%)`;
    const tnum = card.querySelector('.tnum');
    if (tnum) tnum.style.color = color;
    const badge = card.querySelector('.copies-badge');
    if (badge) {
      badge.style.borderColor = Common.hexToRgba(color, 0.55);
      badge.style.color = color;
    }
  }

  function renderBuildList() {
    // Наново будує картки ігор на екрані формування списку.
    ticketsEl.innerHTML = '';
    emptyNote.style.display = state.games.length ? 'none' : 'block';
    state.games.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'ticket';
      card.innerHTML = `
        <div class="tnum"> №${String(i + 1).padStart(2, '0')}</div>
        <div class="tname">${Common.escapeHtml(g.name)}</div>
        <div class="trow">
          <div class="copies-stepper">
            <button class="step-btn minus-btn" type="button" aria-label="Менше копій">−</button>
            <span class="copies-badge">× ${g.copies}</span>
            <button class="step-btn plus-btn" type="button" aria-label="Більше копій">+</button>
          </div>
          <button class="del-btn" data-id="${g.id}">видалити</button>
        </div>`;
      applyCardColor(card, g);
      card.querySelector('.del-btn').addEventListener('click', () => removeGame(g.id));
      card.querySelector('.minus-btn').addEventListener('click', () => changeCopies(g.id, -1));
      card.querySelector('.plus-btn').addEventListener('click', () => changeCopies(g.id, 1));
      ticketsEl.appendChild(card);
    });
    lockBtn.disabled = state.games.length < 2;
  }

  // ---- Останні збережені списки ----
  function renderHistory() {
    const history = Common.loadHistory();
    if (!history.length) {
      historyBlock.style.display = 'none';
      historyList.innerHTML = '';
      return;
    }
    historyBlock.style.display = 'block';
    historyList.innerHTML = '';
    history.forEach(entry => {
      const namesPreview = entry.games.map(g => g.name + (g.copies > 1 ? ' ×' + g.copies : '')).join(', ');
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div class="h-date">${Common.formatSavedAt(entry.savedAt)} · ${entry.games.length} ${entry.games.length === 1 ? 'гра' : 'ігор'}</div>
        <div class="h-names">${Common.escapeHtml(namesPreview)}</div>
        <button class="btn-ghost" type="button">Завантажити</button>`;
      item.querySelector('button').addEventListener('click', () => loadFromHistory(entry.id));
      historyList.appendChild(item);
    });
  }

  function loadFromHistory(id) {
    const history = Common.loadHistory();
    const entry = history.find(h => h.id === id);
    if (!entry) return;
    if (state.games.length && !confirm('Замінити поточний список збереженим? Поточний список ігор буде втрачено.')) return;
    state.games = entry.games.map(g => ({ id: state.nextId++, name: g.name, copies: g.copies }));
    renderBuildList();
    persist();
  }

  // ---- Перехід до сторінки розіграшу ----
  lockBtn.addEventListener('click', () => {
    if (state.games.length < 2) return;
    Common.addToHistory(state.games);
    persist();
    window.location.href = 'draw.html';
  });

  clearBtn.addEventListener('click', () => {
    if (state.games.length === 0) return;
    Common.addToHistory(state.games);
    state.games = [];
    renderBuildList();
    persist();
  });

  resetAllBtn.addEventListener('click', () => {
    // Повне скидання: архівує поточний список (якщо є) і повертає застосунок у початковий стан.
    if (!confirm('Скинути все і почати заново? Поточний список та прогрес розіграшу будуть очищені.')) return;
    Common.addToHistory(state.games);
    state = {
      games: [],
      nextId: 1,
      roundCount: 0,
      logEntries: [],
      visualMode: 'slot',
      instantWinMode: false,
      durationValue: 15
    };
    renderHistory();
    renderBuildList();
    persist();
  });

  addBtn.addEventListener('click', addGame);
  gameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addGame(); });
  copiesInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addGame(); });

  function init() {
    renderHistory();
    renderBuildList();
  }

  init();
})();
