(function(){
  "use strict";

  // ---- Стан застосунку: список ігор і поточний стан розіграшу ----
  let games = [];         // {id, name, copies}
  let nextId = 1;
  let roundActive = false;
  let roundCount = 0;
  let visualMode = 'slot';
  let slotOrder = [];
  let wheelEntries = [];
  let instantWinMode = false; // false = вибуває по 1 копії (за замовчуванням), true = миттєвий переможець
  let logEntries = [];        // {text, isWin} — тримаємо окремо від DOM, щоб зберігати в localStorage

  const STORAGE_KEY = 'lototron_state_v1';
  const HISTORY_KEY = 'lototron_history_v1';
  const MAX_HISTORY = 3;

  // Короткий помічник для пошуку одного HTML-елемента за CSS-селектором.
  const $ = (sel) => document.querySelector(sel);

  // Посилання на елементи інтерфейсу, якими керує скрипт.
  const gameInput = $('#gameInput');
  const copiesInput = $('#copiesInput');
  const addBtn = $('#addBtn');
  const clearBtn = $('#clearBtn');
  const lockBtn = $('#lockBtn');
  const ticketsEl = $('#tickets');
  const emptyNote = $('#emptyNote');

  const buildPanel = $('#buildPanel');
  const drawPanel = $('#drawPanel');
  const drawGamesPanel = $('#drawGamesPanel');
  const logPanel = $('#logPanel');
  const drawTickets = $('#drawTickets');
  const durationRange = $('#durationRange');
  const durVal = $('#durVal');
  const startRoundBtn = $('#startRoundBtn');
  const backBtn = $('#backBtn');
  const statusLine = $('#statusLine');
  const logEl = $('#log');
  const winnerBanner = $('#winnerBanner');
  const winnerName = $('#winnerName');
  const slotMachine = $('#slotMachine');
  const slotStrip = $('#slotStrip');
  const slotViewBtn = $('#slotViewBtn');
  const wheelViewBtn = $('#wheelViewBtn');
  const shuffleVisualsBtn = $('#shuffleVisualsBtn');
  const wheelMachine = $('#wheelMachine');
  const wheelStage = $('#wheelStage');
  const instantWinToggle = $('#instantWinToggle');
  const instantWinLabel = $('#instantWinLabel');
  const resetAllBtn = $('#resetAllBtn');
  const historyBlock = $('#historyBlock');
  const historyList = $('#historyList');

  // Розміри елементів рулетки — потрібні для точного положення стрічки.
  const SLOT_ITEM_H = 56;
  const SLOT_ROWS = 5;
  const SLOT_WINDOW_H = SLOT_ITEM_H * SLOT_ROWS;

  // Палітра кольорів для розрізнення варіантів у слот-машині та колесі.
  const PALETTE_COLORS = ['#E85D5D', '#4ECDC4', '#FFB347', '#7C8CFF', '#C67CFF', '#69B56B', '#5DC8E8', '#FF8FB1', '#F2C14E', '#F2955A'];

  function colorForGame(game){
    // Присвоює грі стабільний колір за її незмінним id — тому колір не «стрибає»,
    // коли інші ігри вибувають і список скорочується.
    return PALETTE_COLORS[game.id % PALETTE_COLORS.length];
  }

  // Перетворює HEX-колір у "rgba(...)" з заданою прозорістю — використовується
  // для м'якого підсвічування фону картки без втрати читабельності тексту.
  function hexToRgba(hex, alpha){
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2), 16);
    const g = parseInt(h.substring(2,4), 16);
    const b = parseInt(h.substring(4,6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ---- Допоміжні функції для роботи зі списком ігор ----
  function normalize(name){ return name.trim().replace(/\s+/g,' '); }

  function findByName(name){
    const n = normalize(name).toLowerCase();
    return games.find(g => g.name.toLowerCase() === n);
  }

  function addGame(){
    // Додає гру або збільшує кількість її копій, якщо така назва вже існує.
    const name = normalize(gameInput.value);
    let copies = parseInt(copiesInput.value, 10);
    if(!name) { gameInput.focus(); return; }
    if(!Number.isFinite(copies) || copies < 1) copies = 1;

    const existing = findByName(name);
    if(existing){
      existing.copies += copies;
    } else {
      games.push({ id: nextId++, name, copies });
    }
    gameInput.value = '';
    copiesInput.value = '1';
    gameInput.focus();
    renderBuildList();
    saveState();
  }

  function removeGame(id){
    // Повністю видаляє гру зі списку за її унікальним ідентифікатором.
    games = games.filter(g => g.id !== id);
    renderBuildList();
    saveState();
  }

  // Змінює кількість копій до старту або між раундами (isDraw визначає поточний екран).
  function changeCopies(id, delta, isDraw){
    const g = games.find(x => x.id === id);
    if(!g) return;
    const next = g.copies + delta;
    if(next < 1) return; // use "видалити" to remove a game entirely
    g.copies = next;
    if(isDraw){
      const el = cardEl(id);
      if(el){
        const badge = el.querySelector('.copies-badge');
        if(badge) badge.textContent = '× ' + g.copies;
        const minus = el.querySelector('.minus-btn');
        if(minus) minus.disabled = g.copies <= 1;
      }
      // Склад секторів і порядок слотів мають одразу врахувати нову кількість копій.
      refreshVisualOrder();
      initSlotIdle();
      renderWheel();
    } else {
      renderBuildList();
    }
    saveState();
  }

  // Застосовує колір гри до картки: рамка зліва, колір номера та легке підсвічування фону.
  function applyCardColor(card, game){
    const color = colorForGame(game);
    card.style.borderLeft = `3px solid ${color}`;
    card.style.background = `linear-gradient(90deg, ${hexToRgba(color, 0.10)}, transparent 60%)`;
    const tnum = card.querySelector('.tnum');
    if(tnum) tnum.style.color = color;
    const badge = card.querySelector('.copies-badge');
    if(badge){
      badge.style.borderColor = hexToRgba(color, 0.55);
      badge.style.color = color;
    }
  }

  function renderBuildList(){
    // Наново будує картки ігор на екрані формування списку.
    ticketsEl.innerHTML = '';
    emptyNote.style.display = games.length ? 'none' : 'block';
    games.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'ticket';
      card.innerHTML = `
        <div class="tnum"> №${String(i+1).padStart(2,'0')}</div>
        <div class="tname">${escapeHtml(g.name)}</div>
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
      card.querySelector('.minus-btn').addEventListener('click', () => changeCopies(g.id, -1, false));
      card.querySelector('.plus-btn').addEventListener('click', () => changeCopies(g.id, 1, false));
      ticketsEl.appendChild(card);
    });
    lockBtn.disabled = games.length < 2;
  }

  function escapeHtml(str){
    // Екранує введений текст, щоб він не міг сприйматись браузером як HTML-код.
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---- Збереження поточного стану застосунку в localStorage (переживає перезавантаження) ----
  function currentScreen(){
    return drawPanel.style.display === 'none' ? 'build' : 'draw';
  }

  function saveState(){
    try{
      const state = {
        screen: currentScreen(),
        games: games.map(g => ({ id: g.id, name: g.name, copies: g.copies })),
        nextId,
        roundCount,
        logEntries,
        visualMode,
        instantWinMode,
        durationValue: durationRange.value
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch(e){ /* сховище недоступне (приватний режим тощо) — просто працюємо без збереження */ }
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const state = JSON.parse(raw);
      if(!state || !Array.isArray(state.games)) return null;
      return state;
    } catch(e){ return null; }
  }

  // ---- Історія останніх (до 3) збережених списків ігор ----
  function loadHistory(){
    try{
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch(e){ return []; }
  }

  function saveHistory(list){
    try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch(e){ /* ignore */ }
  }

  function addToHistory(gamesSnapshot){
    // Архівує поточний список (не більше MAX_HISTORY останніх, без дублю підряд).
    if(!gamesSnapshot || !gamesSnapshot.length) return;
    const serialized = gamesSnapshot.map(g => ({ name: g.name, copies: g.copies }));
    let history = loadHistory();
    if(history.length && JSON.stringify(history[0].games) === JSON.stringify(serialized)) return;
    history.unshift({ id: Date.now(), savedAt: new Date().toISOString(), games: serialized });
    history = history.slice(0, MAX_HISTORY);
    saveHistory(history);
    renderHistory();
  }

  function formatSavedAt(iso){
    const d = new Date(iso);
    if(isNaN(d)) return '';
    const pad = n => String(n).padStart(2,'0');
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderHistory(){
    // Показує до 3 останніх збережених списків із можливістю швидко їх відновити.
    const history = loadHistory();
    if(!history.length){
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
        <div class="h-date">${formatSavedAt(entry.savedAt)} · ${entry.games.length} ${entry.games.length === 1 ? 'гра' : 'ігор'}</div>
        <div class="h-names">${escapeHtml(namesPreview)}</div>
        <button class="btn-ghost" type="button">Завантажити</button>`;
      item.querySelector('button').addEventListener('click', () => loadFromHistory(entry.id));
      historyList.appendChild(item);
    });
  }

  function loadFromHistory(id){
    const history = loadHistory();
    const entry = history.find(h => h.id === id);
    if(!entry) return;
    if(games.length && !confirm('Замінити поточний список збереженим? Поточний список ігор буде втрачено.')) return;
    games = entry.games.map(g => ({ id: nextId++, name: g.name, copies: g.copies }));
    renderBuildList();
    saveState();
  }

  // ---- Перехід від формування списку до етапу розіграшу ----
  lockBtn.addEventListener('click', () => {
    if(games.length < 2) return;
    addToHistory(games);
    buildPanel.style.display = 'none';
    drawGamesPanel.style.display = 'block';
    drawPanel.style.display = 'block';
    logPanel.style.display = 'block';
    renderDrawGrid();
    initSlotIdle();
    updateStatus('Готово до першого раунду.');
    saveState();
  });

  backBtn.addEventListener('click', () => {
    if(roundActive) return;
    drawPanel.style.display = 'none';
    drawGamesPanel.style.display = 'none';
    buildPanel.style.display = 'block';
    renderBuildList();
    saveState();
  });

  clearBtn.addEventListener('click', () => {
    if(games.length === 0) return;
    addToHistory(games);
    games = [];
    renderBuildList();
    saveState();
  });

  resetAllBtn.addEventListener('click', () => {
    // Повне скидання: архівує поточний список (якщо є) і повертає застосунок у початковий стан.
    if(!confirm('Скинути все і почати заново? Поточний список та прогрес розіграшу будуть очищені.')) return;
    addToHistory(games);
    games = [];
    nextId = 1;
    roundCount = 0;
    logEntries = [];
    visualMode = 'slot';
    instantWinMode = false;
    instantWinToggle.checked = false;
    instantWinLabel.classList.remove('mode-active');
    durationRange.value = 15;
    durVal.textContent = '15 сек';
    winnerBanner.classList.remove('show');
    winnerName.textContent = '—';
    drawPanel.style.display = 'none';
    drawGamesPanel.style.display = 'none';
    logPanel.style.display = 'none';
    buildPanel.style.display = 'block';
    setVisualMode('slot');
    renderLogFromEntries();
    renderBuildList();
    saveState();
  });

  addBtn.addEventListener('click', addGame);
  gameInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') addGame(); });
  copiesInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') addGame(); });

  durationRange.addEventListener('input', () => {
    durVal.textContent = durationRange.value + ' сек';
  });
  durationRange.addEventListener('change', () => {
    saveState();
  });

  instantWinToggle.addEventListener('change', () => {
    instantWinMode = instantWinToggle.checked;
    instantWinLabel.classList.toggle('mode-active', instantWinMode);
    saveState();
  });

  // ---- Побудова карток ігор на екрані розіграшу ----
  function renderDrawGrid(){
    drawTickets.innerHTML = '';
    games.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'ticket';
      card.dataset.id = g.id;
      card.innerHTML = `
        <div class="stamp">ВИЛУЧЕНО</div>
        <div class="tnum"> №${String(i+1).padStart(2,'0')}</div>
        <div class="tname">${escapeHtml(g.name)}</div>
        <div class="trow">
          <div class="copies-stepper">
            <button class="step-btn minus-btn" type="button" aria-label="Менше копій" ${g.copies<=1 ? 'disabled' : ''}>−</button>
            <span class="copies-badge">× ${g.copies}</span>
            <button class="step-btn plus-btn" type="button" aria-label="Більше копій">+</button>
          </div>
          <span></span>
        </div>`;
      applyCardColor(card, g);
      card.querySelector('.minus-btn').addEventListener('click', () => { if(!roundActive) changeCopies(g.id, -1, true); });
      card.querySelector('.plus-btn').addEventListener('click', () => { if(!roundActive) changeCopies(g.id, 1, true); });
      drawTickets.appendChild(card);
    });
    refreshVisualOrder();
    renderWheel();
  }

  // Створює новий масив у випадковому порядку, не змінюючи сам список ігор.
  function shuffle(items){
    const shuffled = [...items];
    for(let i=shuffled.length-1;i>0;i--){
      const j = Math.floor(Math.random() * (i+1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Формує спільний випадковий порядок для слот-машини та окремих секторів колеса.
  function refreshVisualOrder(){
    slotOrder = shuffle(games);
    wheelEntries = shuffle(slotOrder.flatMap(g => Array.from({length:g.copies}, () => g)));
  }

  function wheelSectorPath(cx, cy, r, start, end){
    const a = (Math.PI / 180) * start;
    const b = (Math.PI / 180) * end;
    const x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a);
    const x2 = cx + r * Math.cos(b), y2 = cy + r * Math.sin(b);
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${end-start > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
  }

  // Малює SVG-колесо. Кожна копія гри — окремий сектор; порядок завжди випадковий.
  function renderWheel(entries = wheelEntries){
    const count = entries.length;
    if(!count){
      wheelStage.innerHTML = '';
      return [];
    }
    const size = 400, center = size / 2, radius = 196;
    const sectorAngle = 360 / count;
    const labelStart = 31;
    const labelLength = radius - labelStart - 12;
    const labelAngleWidth = 2 * (center + 72) * Math.sin((sectorAngle / 2) * Math.PI / 180);
    const sectors = entries.map((game, index) => {
      const start = -90 + index * sectorAngle;
      const end = start + sectorAngle;
      const mid = start + sectorAngle / 2;
      const label = escapeHtml(game.name);
      const fontSize = Math.max(3.5, Math.min(12, labelLength / Math.max(1, game.name.length * 0.58), labelAngleWidth * 0.72));
      const estimatedWidth = game.name.length * fontSize * 0.58;
      const textLength = Math.min(labelLength, estimatedWidth);
      return `<path d="${wheelSectorPath(center, center, radius, start, end)}" fill="${colorForGame(game)}" fill-opacity="0.82" stroke="#12161B" stroke-width="1"></path><g transform="rotate(${mid} ${center} ${center})"><text class="wheel-label" style="font-size:${fontSize.toFixed(2)}px" x="${center + labelStart}" y="${center}" textLength="${textLength.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${label}</text></g>`;
    }).join('');
    wheelStage.innerHTML = `<svg id="wheelSvg" viewBox="0 0 ${size} ${size}" aria-hidden="true">${sectors}<circle class="wheel-hub" cx="${center}" cy="${center}" r="23"></circle><circle fill="var(--amber)" cx="${center}" cy="${center}" r="7"></circle></svg>`;
    return entries;
  }

  function setVisualMode(mode){
    if(roundActive) return;
    visualMode = mode;
    const useWheel = mode === 'wheel';
    slotMachine.style.display = useWheel ? 'none' : 'block';
    wheelMachine.style.display = useWheel ? 'block' : 'none';
    slotViewBtn.classList.toggle('active', !useWheel);
    slotViewBtn.setAttribute('aria-pressed', String(!useWheel));
    wheelViewBtn.classList.toggle('active', useWheel);
    wheelViewBtn.setAttribute('aria-pressed', String(useWheel));
    if(useWheel) renderWheel();
    saveState();
  }

  function updateStatus(text, mode){
    // Виводить короткий текстовий статус; mode додає клас для різного кольору.
    statusLine.textContent = text;
    statusLine.className = 'status-line' + (mode ? ' ' + mode : '');
  }

  function logLine(text, isWin){
    // Додає один запис до журналу; переможний запис виділяється окремим стилем.
    logEntries.push({ text, isWin: !!isWin });
    const li = document.createElement('li');
    li.innerHTML = text;
    if(isWin) li.classList.add('win-line');
    logEl.appendChild(li);
    logEl.scrollTop = logEl.scrollHeight;
    saveState();
  }

  function renderLogFromEntries(){
    // Перебудовує журнал у DOM з масиву logEntries (використовується при відновленні стану).
    logEl.innerHTML = '';
    logEntries.forEach(entry => {
      const li = document.createElement('li');
      li.innerHTML = entry.text;
      if(entry.isWin) li.classList.add('win-line');
      logEl.appendChild(li);
    });
    logEl.scrollTop = logEl.scrollHeight;
  }

  function cardEl(id){
    return drawTickets.querySelector(`.ticket[data-id="${id}"]`);
  }

  // Зважений вибір: гра з більшою кількістю копій має вищий шанс бути обраною цим викликом.
  // Використовується для декоративного заповнення стрічки під час спіну та в режимі
  // «миттєвий переможець», де сам вибір і є фінальним результатом.
  function weightedPick(){
    const total = games.reduce((s,g) => s + g.copies, 0);
    let r = Math.random() * total;
    for(const g of games){
      if(r < g.copies) return g;
      r -= g.copies;
    }
    return games[games.length-1];
  }

  // Рівноймовірний вибір: кожна гра має однаковий шанс потрапити в раунд незалежно
  // від кількості копій. У звичайному режимі копії лише визначають, скільки «влучань»
  // гра витримає, перш ніж вибути повністю — тому саме завдяки цьому більше копій
  // підвищує шанс дійти до кінця й перемогти, а не шанс бути обраною в конкретному раунді.
  function uniformPick(){
    return games[Math.floor(Math.random() * games.length)];
  }

  function slotItemHtml(g){
    return `<div class="slot-item"><span style="color:${colorForGame(g)}">${escapeHtml(g.name)}</span></div>`;
  }

  // Показує нерухому рулетку з поточними іграми перед запуском раунду.
  function initSlotIdle(){
    slotMachine.classList.remove('spinning', 'slot-landed');
    const pool = slotOrder.length ? slotOrder : (games.length ? games : [{ name: '—' }]);
    const items = [];
    for(let i=0;i<Math.max(SLOT_ROWS, pool.length);i++){
      items.push(pool[i % pool.length]);
    }
    // Центр вікна розрахований так, щоб над і під обраним рядком було
    // порівну місця (SLOT_ROWS=5 → 2 елементи зверху, 1 у центрі, 2 знизу) —
    // це заповнює всі 5 позицій вікна без порожнього проміжку зверху.
    const centerIndex = Math.min(Math.floor(SLOT_ROWS/2), items.length-1);
    slotStrip.innerHTML = items.map(slotItemHtml).join('');
    slotStrip.style.transition = 'none';
    const ty = (SLOT_WINDOW_H/2 - SLOT_ITEM_H/2) - centerIndex*SLOT_ITEM_H;
    slotStrip.style.transform = `translateY(${ty}px)`;
  }

  // Запускає анімацію рулетки, зупиняє її на target і викликає onDone після зупинки.
  function spinSlot(target, durationSec, onDone){
    slotMachine.classList.remove('slot-landed');
    slotMachine.classList.add('spinning');
    slotStrip.classList.add('spinning');

    const itemsCount = Math.max(24, Math.min(160, Math.round(durationSec * 3)));
    const targetIndex = itemsCount - 3;
    const items = [];
    for(let i=0;i<itemsCount;i++) items.push(weightedPick());
    items[targetIndex] = target;

    slotStrip.innerHTML = items.map(slotItemHtml).join('');

    // Спершу миттєво повертаємо стрічку вгору, а потім запускаємо плавну анімацію.
    slotStrip.style.transition = 'none';
    slotStrip.style.transform = 'translateY(0px)';
    // eslint-disable-next-line no-unused-expressions
    slotStrip.offsetHeight;

    const finalTy = (SLOT_WINDOW_H/2 - SLOT_ITEM_H/2) - targetIndex*SLOT_ITEM_H;

    requestAnimationFrame(() => {
      slotStrip.style.transition = `transform ${durationSec}s cubic-bezier(0.15, 0.82, 0.22, 1)`;
      slotStrip.style.transform = `translateY(${finalTy}px)`;
    });

    setTimeout(() => {
      slotStrip.classList.remove('spinning');
    }, Math.max(0, durationSec*1000 - 350));

    const onEnd = (e) => {
      if(e.propertyName !== 'transform') return;
      slotStrip.removeEventListener('transitionend', onEnd);
      slotMachine.classList.remove('spinning');
      slotMachine.classList.add('slot-landed');
      onDone(target);
    };
    slotStrip.addEventListener('transitionend', onEnd);
  }

  // Обертає колесо так, щоб один із секторів обраної гри зупинився під стрілкою.
  function spinWheel(target, durationSec, onDone){
    const entries = shuffle(games.flatMap(g => Array.from({length:g.copies}, () => g)));
    const targetIndex = entries.findIndex(g => g.id === target.id);
    renderWheel(entries);
    const wheelSvg = $('#wheelSvg');
    const sectorAngle = 360 / entries.length;
    const turns = Math.max(4, Math.round(durationSec * 1.5));
    const finalRotation = turns * 360 - (targetIndex + 0.5) * sectorAngle;
    wheelMachine.classList.add('spinning');
    wheelSvg.style.transition = 'none';
    wheelSvg.style.transform = 'rotate(0deg)';
    wheelSvg.offsetHeight;
    requestAnimationFrame(() => {
      wheelSvg.style.transition = `transform ${durationSec}s cubic-bezier(0.15, 0.82, 0.22, 1)`;
      wheelSvg.style.transform = `rotate(${finalRotation}deg)`;
    });
    wheelSvg.addEventListener('transitionend', function onEnd(e){
      if(e.propertyName !== 'transform') return;
      wheelSvg.removeEventListener('transitionend', onEnd);
      wheelMachine.classList.remove('spinning');
      onDone(target);
    });
  }

  startRoundBtn.addEventListener('click', () => {
    if(roundActive || games.length < 2) return;
    runRound(parseInt(durationRange.value, 10));
  });

  function runRound(durationSec){
    // Блокує керування на час раунду, обирає ціль і запускає рулетку.
    roundActive = true;
    startRoundBtn.disabled = true;
    backBtn.disabled = true;
    lockBtn.disabled = true;
    instantWinToggle.disabled = true;
    setStepperButtonsDisabled(true);
    roundCount++;
    updateStatus(`Раунд ${roundCount} триває...`, 'active');

    const target = instantWinMode ? weightedPick() : uniformPick();
    const spin = visualMode === 'wheel' ? spinWheel : spinSlot;
    spin(target, durationSec, () => {
      const el = cardEl(target.id);
      finishRound(target, el);
    });
  }

  function finishRound(target, el){
    if(instantWinMode){
      // Режим миттєвого переможця: обрана гра одразу стає фінальним переможцем,
      // усі інші ігри вилучаються одним раундом.
      if(el) el.classList.add('winner-picked');
      logLine(`Раунд ${roundCount}: <b>${escapeHtml(target.name)}</b> — переможець обраний миттєво`, true);
      setTimeout(() => {
        games.forEach(g => {
          if(g.id !== target.id){
            const otherEl = cardEl(g.id);
            if(otherEl){
              const stamp = otherEl.querySelector('.stamp');
              if(stamp) stamp.classList.add('show');
              otherEl.classList.add('eliminated');
            }
          }
        });
        setTimeout(() => {
          games = games.filter(g => g.id === target.id);
          renderDrawGrid();
          afterRoundCleanup();
        }, 380);
      }, 550);
      return;
    }

    // Зменшує кількість копій обраної гри та вилучає її, коли копій не лишається.
    target.copies -= 1;
    const eliminatedFully = target.copies <= 0;
    saveState();

    if(el) el.classList.add('winner-picked');

    if(eliminatedFully){
      logLine(`Раунд ${roundCount}: <b>${escapeHtml(target.name)}</b> — вилучено повністю`);
      if(el){
        const stamp = el.querySelector('.stamp');
        if(stamp) stamp.classList.add('show');
        setTimeout(() => {
          el.classList.add('eliminated');
          setTimeout(() => {
            games = games.filter(g => g.id !== target.id);
            renderDrawGrid();
            afterRoundCleanup();
          }, 380);
        }, 550);
      } else {
        games = games.filter(g => g.id !== target.id);
        renderDrawGrid();
        afterRoundCleanup();
      }
    } else {
      logLine(`Раунд ${roundCount}: <b>${escapeHtml(target.name)}</b> — знято копію, залишилось ${target.copies}`);
      setTimeout(() => {
        if(el){
          el.classList.remove('winner-picked');
          const badge = el.querySelector('.copies-badge');
          if(badge) badge.textContent = '× ' + target.copies;
        }
        afterRoundCleanup();
      }, 900);
    }
  }

  function setStepperButtonsDisabled(disabled){
    // Блокує або розблоковує кнопки «+» і «−» на картках.
    drawTickets.querySelectorAll('.plus-btn').forEach(b => b.disabled = disabled);
    drawTickets.querySelectorAll('.minus-btn').forEach(b => {
      const id = Number(b.closest('.ticket').dataset.id);
      const g = games.find(x => x.id === id);
      b.disabled = disabled || !g || g.copies <= 1;
    });
  }

  function showSlotWinner(winner){
    // Після завершення розіграшу показує переможця в центральному вікні рулетки.
    slotMachine.classList.remove('spinning');
    slotMachine.classList.add('slot-landed');
    slotStrip.classList.remove('spinning');
    const items = [winner, winner, winner];
    slotStrip.innerHTML = items.map(slotItemHtml).join('');
    slotStrip.style.transition = 'none';
    const ty = (SLOT_WINDOW_H/2 - SLOT_ITEM_H/2) - 1*SLOT_ITEM_H;
    slotStrip.style.transform = `translateY(${ty}px)`;
  }

  function showFinishedState(winner){
    // Оформлює екран завершеного розіграшу: банер, підсвітку картки й нерухому рулетку.
    startRoundBtn.disabled = true;
    lockBtn.disabled = true;
    instantWinToggle.disabled = true;
    setStepperButtonsDisabled(true);
    updateStatus('Розіграш завершено.', 'win');
    winnerName.textContent = winner.name;
    winnerBanner.classList.add('show');
    const wc = cardEl(winner.id);
    if(wc) wc.classList.add('final-winner');
    showSlotWinner(winner);
  }

  function afterRoundCleanup(){
    // Повертає інтерфейс у готовий стан або оформлює фінальну перемогу.
    roundActive = false;
    backBtn.disabled = false;
    setStepperButtonsDisabled(false);

    if(games.length <= 1){
      const winner = games[0];
      if(winner){
        logLine(`Переможець: <b>${escapeHtml(winner.name)}</b>`, true);
        showFinishedState(winner);
      }
    } else {
      startRoundBtn.disabled = false;
      lockBtn.disabled = false;
      instantWinToggle.disabled = false;
      updateStatus(`Тут закінчили ${roundCount+1}. Залишилось ігор: ${games.length}.`);
    }
    saveState();
  }

  // Початкове відображення порожнього списку після завантаження сторінки.
  slotViewBtn.addEventListener('click', () => setVisualMode('slot'));
  wheelViewBtn.addEventListener('click', () => setVisualMode('wheel'));
  shuffleVisualsBtn.addEventListener('click', () => {
    if(roundActive) return;
    refreshVisualOrder();
    initSlotIdle();
    renderWheel();
  });

  // ---- Відновлення стану після перезавантаження сторінки ----
  function applyRestoredScreen(state){
    games = state.games.map(g => ({ id: g.id, name: g.name, copies: g.copies }));
    const maxId = games.reduce((m,g) => Math.max(m, g.id), 0);
    nextId = Number.isFinite(state.nextId) ? Math.max(state.nextId, maxId + 1) : maxId + 1;
    roundCount = Number.isFinite(state.roundCount) ? state.roundCount : 0;
    logEntries = Array.isArray(state.logEntries) ? state.logEntries : [];
    visualMode = state.visualMode === 'wheel' ? 'wheel' : 'slot';
    instantWinMode = !!state.instantWinMode;
    instantWinToggle.checked = instantWinMode;
    instantWinLabel.classList.toggle('mode-active', instantWinMode);
    if(state.durationValue){
      durationRange.value = state.durationValue;
      durVal.textContent = durationRange.value + ' сек';
    }

    if(state.screen === 'draw' && games.length){
      buildPanel.style.display = 'none';
      drawGamesPanel.style.display = 'block';
      drawPanel.style.display = 'block';
      logPanel.style.display = 'block';
      renderDrawGrid();
      setVisualMode(visualMode);
      initSlotIdle();
      renderLogFromEntries();
      if(games.length <= 1){
        const winner = games[0];
        if(winner) showFinishedState(winner);
      } else {
        updateStatus(`Готово до раунду ${roundCount+1}. Залишилось ігор: ${games.length}.`);
        startRoundBtn.disabled = false;
        lockBtn.disabled = true;
        backBtn.disabled = false;
        instantWinToggle.disabled = false;
      }
    } else {
      buildPanel.style.display = 'block';
      drawGamesPanel.style.display = 'none';
      drawPanel.style.display = 'none';
      logPanel.style.display = 'none';
      renderLogFromEntries();
      renderBuildList();
    }
  }

  function init(){
    renderHistory();
    const saved = loadState();
    const hasSomethingToRestore = saved && (saved.games.length || (Array.isArray(saved.logEntries) && saved.logEntries.length));
    if(hasSomethingToRestore){
      applyRestoredScreen(saved);
    } else {
      renderBuildList();
    }
  }

  init();
})();