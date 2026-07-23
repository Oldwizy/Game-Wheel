// common.js — спільні дані та допоміжні функції для обох сторінок застосунку
// (сторінки списку ігор та сторінки розіграшу). Підключається першим,
// перед build.js або draw.js.
(function (global) {
  "use strict";

  const STORAGE_KEY = 'lototron_state_v1';
  const HISTORY_KEY = 'lototron_history_v1';
  const MAX_HISTORY = 3;

  // Палітра кольорів для розрізнення варіантів у слот-машині та колесі.
  const PALETTE_COLORS = ['#E85D5D', '#4ECDC4', '#FFB347', '#7C8CFF', '#C67CFF', '#69B56B', '#5DC8E8', '#FF8FB1', '#F2C14E', '#F2955A'];

  // Стан за замовчуванням — використовується, коли в localStorage ще нічого немає.
  function defaultState() {
    return {
      games: [],          // {id, name, copies}
      nextId: 1,
      roundCount: 0,
      logEntries: [],     // {text, isWin}
      visualMode: 'slot',
      instantWinMode: false,
      durationValue: 15
    };
  }

  // ---- Загальний стан застосунку (список ігор, лог, налаштування раунду) ----
  // Обидві сторінки читають і записують один і той самий об'єкт, тому перехід
  // між сторінками (замість перемикання display:none/block) не втрачає дані.
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.games)) return defaultState();
      return Object.assign(defaultState(), parsed);
    } catch (e) { return defaultState(); }
  }

  function saveState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* сховище недоступне (приватний режим тощо) — просто працюємо без збереження */ }
  }

  // ---- Історія останніх (до 3) збережених списків ігор ----
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function addToHistory(gamesSnapshot) {
    // Архівує поточний список (не більше MAX_HISTORY останніх, без дублю підряд).
    if (!gamesSnapshot || !gamesSnapshot.length) return;
    const serialized = gamesSnapshot.map(g => ({ name: g.name, copies: g.copies }));
    let history = loadHistory();
    if (history.length && JSON.stringify(history[0].games) === JSON.stringify(serialized)) return;
    history.unshift({ id: Date.now(), savedAt: new Date().toISOString(), games: serialized });
    history = history.slice(0, MAX_HISTORY);
    saveHistory(history);
  }

  function formatSavedAt(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---- Кольори та безпечний вивід тексту ----
  function colorForGame(game) {
    // Присвоює грі стабільний колір за її незмінним id — тому колір не «стрибає»,
    // коли інші ігри вибувають і список скорочується.
    return PALETTE_COLORS[game.id % PALETTE_COLORS.length];
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function escapeHtml(str) {
    // Екранує введений текст, щоб він не міг сприйматись браузером як HTML-код.
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function normalize(name) { return name.trim().replace(/\s+/g, ' '); }

  global.Common = {
    loadState, saveState,
    loadHistory, saveHistory, addToHistory, formatSavedAt,
    colorForGame, hexToRgba, escapeHtml, normalize,
    PALETTE_COLORS
  };
})(window);
