// draw.js — логіка сторінки "Розіграш" (draw.html).
// Слот-машина / колесо, вибування копій, журнал раундів. Список ігор і всі
// налаштування завантажуються зі спільного стану (localStorage), який
// сформувала сторінка index.html.
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const drawGamesPanel = $('#drawGamesPanel');
  const drawPanel = $('#drawPanel');
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
  const wheelResultPopup = $('#wheelResultPopup');
  const wheelResultName = $('#wheelResultName');
  const wheelKeepBtn = $('#wheelKeepBtn');
  const wheelRemoveBtn = $('#wheelRemoveBtn');
  const wheelPointerEl = wheelMachine.querySelector('.wheel-pointer');

  const instantWinToggle = $('#instantWinToggle');
  const instantWinLabel = $('#instantWinLabel');

  // Розміри елементів рулетки — потрібні для точного положення стрічки.
  // Висота одного пункту фіксована (56px, як і .slot-item у styles.css),
  // а от кількість видимих рядів і загальна висота вікна тепер РАХУЮТЬСЯ
  // з фактичного розміру .slot-window (він росте й заповнює всю висоту
  // #drawPanel через flex у styles.css) — а не задані наперед константою,
  // як було, коли вікно мало жорстку висоту 168px.
  const SLOT_ITEM_H = 56;
  const slotWindow = slotMachine.querySelector('.slot-window');
  let slotRows = 3;
  let SLOT_WINDOW_H = SLOT_ITEM_H * slotRows;

  // Вимірює поточну висоту .slot-window, рахує скільки повних рядів по 56px
  // у неї влазить (мінімум 3, завжди непарне число — щоб був чіткий
  // центральний ряд), і виставляє вікну РІВНО таку висоту через inline-style.
  // Це потрібно викликати перед будь-яким рендером стрічки (idle/спін/фінал),
  // інакше висота "попливе" між флекс-розкладкою (дробові пікселі) і
  // математикою центрування (яка рахує рівно на цілі ряди по 56px).
  function syncSlotWindowMetrics() {
    // Спочатку повертаємо ріст (на випадок, якщо попередній виклик його
    // заблокував нижче) і скидаємо висоту, щоб flexbox порахував природну
    // доступну висоту .slot-window усередині .slot-machine.
    slotWindow.style.flex = '1 1 auto';
    slotWindow.style.height = '';
    const naturalH = slotWindow.clientHeight || SLOT_ITEM_H * 3;
    let rows = Math.max(3, Math.floor(naturalH / SLOT_ITEM_H));
    if (rows % 2 === 0) rows -= 1; // непарна кількість — є чіткий центральний ряд
    slotRows = Math.max(3, rows);
    SLOT_WINDOW_H = SLOT_ITEM_H * slotRows;
    // Тепер вимикаємо flex-grow і фіксуємо РІВНО округлену висоту. Без цього
    // кроку flexbox просто розтягнув би вікно назад на всю доступну висоту
    // (ігноруючи округлення до цілого ряду), і реальна видима висота не
    // збігалася б із тим, що закладено в математику центрування нижче —
    // саме це й показувало зайвий/неправильно розташований рядок.
    slotWindow.style.flex = '0 0 auto';
    slotWindow.style.height = SLOT_WINDOW_H + 'px';
    return SLOT_WINDOW_H;
  }

  // ---- Стан застосунку, спільний з index.html через localStorage ----
  let state = Common.loadState();

  // Якщо на цю сторінку зайшли напряму, а список ігор порожній — тут нічого
  // розігрувати, повертаємо користувача до формування списку.
  if (!state.games.length) {
    window.location.href = 'index.html';
    return;
  }

  let games = state.games;
  let roundCount = state.roundCount;
  let logEntries = state.logEntries;
  let visualMode = state.visualMode;
  let instantWinMode = state.instantWinMode;
  let roundActive = false;
  let slotOrder = [];
  let wheelEntries = [];

  // ---- Стан режиму "Батл-рояль" ----
  const battleMachine = $('#battleMachine');
  const battleCanvas = $('#battleCanvas');
  const battleViewBtn = $('#battleViewBtn');
  const durationBlock = document.querySelector('.duration-block');
  // Швидкість більше не залежить від повзунка тривалості (його для цього
  // режиму сховано) — множники від розміру арени: idle трохи повільніше,
  // бій — помітно швидше, але без хаосу ("висока, але не надто").
  const BATTLE_SPEED_IDLE_FACTOR = 0.16;
  const BATTLE_SPEED_FIGHT_FACTOR = 0.34;
  let battleArenaW = 400;
  let battleArenaH = 300;
  let battleCtx = null;
  let battleBalls = [];       // {gameId, name, color, hp, maxHp, r, x, y, vx, vy}
  let battleAnimId = null;
  let battleLastTs = null;
  const battleHitCooldowns = new Map(); // щоб одна пара кульок не била по кілька разів за один дотик

  function persist() {
    state.games = games;
    state.roundCount = roundCount;
    state.logEntries = logEntries;
    state.visualMode = visualMode;
    state.instantWinMode = instantWinMode;
    state.durationValue = durationRange.value;
    Common.saveState(state);
  }

  function applyCardColor(card, game) {
    const color = Common.colorForGame(game);
    card.style.borderLeft = `3px solid ${color}`;
    card.style.background = `linear-gradient(90deg, ${Common.hexToRgba(color, 0.10)}, transparent 60%), var(--panel-raised)`;
    const tnum = card.querySelector('.tnum');
    if (tnum) tnum.style.color = color;
    const badge = card.querySelector('.copies-badge');
    if (badge) {
      badge.style.borderColor = Common.hexToRgba(color, 0.55);
      badge.style.color = color;
    }
  }

  // Змінює кількість копій між раундами.
  function changeCopies(id, delta) {
    const g = games.find(x => x.id === id);
    if (!g) return;
    const next = g.copies + delta;
    if (next < 1) return;
    g.copies = next;
    const el = cardEl(id);
    if (el) {
      const badge = el.querySelector('.copies-badge');
      if (badge) badge.textContent = '× ' + g.copies;
      const minus = el.querySelector('.minus-btn');
      if (minus) minus.disabled = g.copies <= 1;
    }
    // Склад секторів і порядок слотів мають одразу врахувати нову кількість копій.
    refreshVisualOrder();
    initSlotIdle();
    renderWheel();
    persist();
  }

  backBtn.addEventListener('click', () => {
    if (roundActive) return;
    persist();
    window.location.href = 'index.html';
  });

  durationRange.addEventListener('input', () => {
    durVal.textContent = durationRange.value + ' сек';
  });
  durationRange.addEventListener('change', () => {
    persist();
  });

  instantWinToggle.addEventListener('change', () => {
    instantWinMode = instantWinToggle.checked;
    instantWinLabel.classList.toggle('mode-active', instantWinMode);
    persist();
  });

  // ---- Побудова карток ігор на екрані розіграшу ----
  function renderDrawGrid() {
    drawTickets.innerHTML = '';
    games.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'ticket';
      card.dataset.id = g.id;
      card.innerHTML = `
        <div class="stamp">ВИЛУЧЕНО</div>
        <div class="tnum"> №${String(i + 1).padStart(2, '0')}</div>
        <div class="tname">${Common.escapeHtml(g.name)}</div>
        <div class="trow">
          <div class="copies-stepper">
            <button class="step-btn minus-btn" type="button" aria-label="Менше копій" ${g.copies <= 1 ? 'disabled' : ''}>−</button>
            <span class="copies-badge">× ${g.copies}</span>
            <button class="step-btn plus-btn" type="button" aria-label="Більше копій">+</button>
          </div>
          <span></span>
        </div>`;
      applyCardColor(card, g);
      card.querySelector('.minus-btn').addEventListener('click', () => { if (!roundActive) changeCopies(g.id, -1); });
      card.querySelector('.plus-btn').addEventListener('click', () => { if (!roundActive) changeCopies(g.id, 1); });
      drawTickets.appendChild(card);
    });
    refreshVisualOrder();
    renderWheel();
  }

  // Створює новий масив у випадковому порядку, не змінюючи сам список ігор.
  function shuffle(items) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Формує спільний випадковий порядок для слот-машини та окремих секторів колеса.
  function refreshVisualOrder() {
    slotOrder = shuffle(games);
    wheelEntries = shuffle(slotOrder.flatMap(g => Array.from({ length: g.copies }, () => g)));
  }

  function wheelSectorPath(cx, cy, r, start, end) {
    const a = (Math.PI / 180) * start;
    const b = (Math.PI / 180) * end;
    const x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a);
    const x2 = cx + r * Math.cos(b), y2 = cy + r * Math.sin(b);
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
  }

  // Малює SVG-колесо. Кожна копія гри — окремий сектор; порядок завжди випадковий.
  function renderWheel(entries = wheelEntries) {
    const count = entries.length;
    if (!count) {
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
      const label = Common.escapeHtml(game.name);
      const fontSize = Math.max(3.5, Math.min(16, labelLength / Math.max(1, game.name.length * 0.58), labelAngleWidth * 0.85));
      const estimatedWidth = game.name.length * fontSize * 0.58;
      const textLength = Math.min(labelLength, estimatedWidth);
      return `<path d="${wheelSectorPath(center, center, radius, start, end)}" fill="${Common.colorForGame(game)}" fill-opacity="0.82" stroke="#12161B" stroke-width="1"></path><g transform="rotate(${mid} ${center} ${center})"><text class="wheel-label" style="font-size:${fontSize.toFixed(2)}px" x="${center + labelStart + labelLength}" y="${center}" textLength="${textLength.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${label}</text></g>`;
    }).join('');
    wheelStage.innerHTML = `<svg id="wheelSvg" viewBox="0 0 ${size} ${size}" aria-hidden="true">${sectors}<circle class="wheel-hub" cx="${center}" cy="${center}" r="23"></circle><circle fill="var(--amber)" cx="${center}" cy="${center}" r="7"></circle></svg>`;
    return entries;
  }

  // Вимірює фактично доступний простір .wheel-machine (він росте й заповнює
  // всю висоту #drawPanel через flex, так само як .slot-window) і виставляє
  // квадратному .wheel-stage розмір у px, що дорівнює МЕНШІЙ з двох величин —
  // доступної ширини або доступної висоти. Це потрібно, щоб колесо
  // масштабувалось на всю висоту блоку, а не лишалось фіксованого розміру
  // (aspect-ratio сам собою не може одночасно врахувати й ширину, і висоту
  // контейнера — тому розмір рахує JS, як і для рулетки вище).
  function syncWheelStageMetrics() {
    wheelStage.style.width = '';
    wheelStage.style.height = '';
    const availW = wheelMachine.clientWidth;
    const availH = wheelMachine.clientHeight;
    const size = Math.max(160, Math.min(availW, availH || availW));
    wheelStage.style.width = size + 'px';
    wheelStage.style.height = size + 'px';
  }

  // ---- HP і розмір кульки ----
  function ballHp(game) {
    // 100 за замовчуванням (1 копія), кожна наступна копія +5 HP.
    // Якщо треба, щоб КОЖНА копія (включно з першою) давала +5 — заміни на:
    //   return 100 + game.copies * 5;
    return 100 + Math.max(0, game.copies - 1) * 5;
  }

  function ballRadius(hp) {
    return Math.max(20, Math.min(52, 16 + Math.sqrt(hp) * 2.6));
  }

  // ---- Розмір canvas: арена займає всю ширину й доступну висоту панелі
  // (на відміну від колеса, тут НЕ квадрат — просто фактичний прямокутник
  // .battle-machine), тому фізика й малювання рахуються прямо в px цього
  // прямокутника (battleArenaW × battleArenaH), а не в фіксованій "решітці".
  function syncBattleCanvasMetrics() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(160, battleMachine.clientWidth);
    const h = Math.max(160, battleMachine.clientHeight);
    battleCanvas.style.width = w + 'px';
    battleCanvas.style.height = h + 'px';
    battleCanvas.width = Math.round(w * dpr);
    battleCanvas.height = Math.round(h * dpr);
    battleCtx = battleCanvas.getContext('2d');
    battleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    battleArenaW = w;
    battleArenaH = h;
  }

  // Розставляє кульки для всіх ігор у games. Швидкість тепер НЕ залежить від
  // повзунка тривалості (його для цього режиму просто немає в інтерфейсі) —
  // задається константою-множником від розміру арени: idle-режим трохи
  // повільніший, сам бій — помітно швидший, але без хаосу.
  function initBattleBalls(speedFactor) {
    battleHitCooldowns.clear();
    const speed = Math.hypot(battleArenaW, battleArenaH) * speedFactor;
    const balls = [];
    games.forEach(g => {
      const hp = ballHp(g);
      const r = ballRadius(hp);
      let x, y, tries = 0;
      do {
        x = r + Math.random() * (battleArenaW - r * 2);
        y = r + Math.random() * (battleArenaH - r * 2);
        tries++;
      } while (tries < 30 && balls.some(b => Math.hypot(b.x - x, b.y - y) < b.r + r + 4));
      const angle = Math.random() * Math.PI * 2;
      balls.push({
        gameId: g.id, name: g.name, color: Common.colorForGame(g),
        hp, maxHp: hp, r, x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed
      });
    });
    battleBalls = balls;
  }

  // Один крок фізики: рух, відбиття від країв арени, зіткнення кулька-кулька.
  // dealDamage=false у режимі очікування (кульки просто літають без шкоди).
  function stepBattlePhysics(dt, dealDamage) {
    const now = performance.now();
    battleBalls.forEach(b => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x - b.r < 0) { b.x = b.r; b.vx *= -1; }
      if (b.x + b.r > battleArenaW) { b.x = battleArenaW - b.r; b.vx *= -1; }
      if (b.y - b.r < 0) { b.y = b.r; b.vy *= -1; }
      if (b.y + b.r > battleArenaH) { b.y = battleArenaH - b.r; b.vy *= -1; }
    });
    for (let i = 0; i < battleBalls.length; i++) {
      for (let j = i + 1; j < battleBalls.length; j++) {
        const a = battleBalls[i], b = battleBalls[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = a.r + b.r;
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2;
          const nx = dx / dist, ny = dy / dist;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          // пружне відбиття (рівна маса — обмін швидкістю вздовж нормалі)
          const avn = a.vx * nx + a.vy * ny;
          const bvn = b.vx * nx + b.vy * ny;
          a.vx += (bvn - avn) * nx; a.vy += (bvn - avn) * ny;
          b.vx += (avn - bvn) * nx; b.vy += (avn - bvn) * ny;
          if (dealDamage) {
            const pairKey = a.gameId < b.gameId ? a.gameId + '_' + b.gameId : b.gameId + '_' + a.gameId;
            const last = battleHitCooldowns.get(pairKey) || 0;
            if (now - last > 350) {
              battleHitCooldowns.set(pairKey, now);
              const dmg = 6 + Math.random() * 8;
              a.hp -= dmg; b.hp -= dmg;
            }
          }
        }
      }
    }
  }

  function drawBattleFrame() {
    if (!battleCtx) return;
    const ctx = battleCtx;
    ctx.clearRect(0, 0, battleArenaW, battleArenaH);
    battleBalls.forEach(b => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = Common.hexToRgba(b.color, 0.85);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = b.color;
      ctx.stroke();

      const pct = Math.max(0, b.hp / b.maxHp);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 4, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
      ctx.strokeStyle = pct > 0.3 ? '#4ECDC4' : '#E85D5D';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = '#EDEFF2';
      ctx.font = `${Math.max(9, Math.min(13, b.r * 0.42))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let label = b.name;
      const maxChars = Math.max(4, Math.floor(b.r / 3));
      if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '…';
      ctx.fillText(label, b.x, b.y);
    });
  }

  function stopBattleLoop() {
    if (battleAnimId) { cancelAnimationFrame(battleAnimId); battleAnimId = null; }
    battleLastTs = null;
  }

  function battleIdleLoop(ts) {
    if (!battleLastTs) battleLastTs = ts;
    const dt = Math.min(0.05, (ts - battleLastTs) / 1000);
    battleLastTs = ts;
    stepBattlePhysics(dt, false);
    drawBattleFrame();
    battleAnimId = requestAnimationFrame(battleIdleLoop);
  }

  // Показує кульки, що просто мирно літають до старту бою (трохи повільніше,
  // ніж під час самого бою — див. BATTLE_SPEED_IDLE_FACTOR нижче).
  function initBattleIdle() {
    stopBattleLoop();
    battleMachine.classList.remove('active');
    if (!games.length) { if (battleCtx) battleCtx.clearRect(0, 0, battleArenaW, battleArenaH); return; }
    syncBattleCanvasMetrics();
    initBattleBalls(BATTLE_SPEED_IDLE_FACTOR);
    battleLastTs = null;
    battleAnimId = requestAnimationFrame(battleIdleLoop);
  }

  function eliminateBattleBall(b) {
    roundCount++;
    const el = cardEl(b.gameId);
    if (el) {
      const stamp = el.querySelector('.stamp');
      if (stamp) stamp.classList.add('show');
    }
    logLine(`Раунд ${roundCount}: <b>${Common.escapeHtml(b.name)}</b> — вибув з бою (HP вичерпано)`, false, { gameId: b.gameId, gameName: b.name });
    // Спершу лише позначаємо картку (стемп "ВИЛУЧЕНО"), а саму гру з масиву
    // й картку з DOM прибираємо трохи згодом — після короткої анімації
    // зникнення (клас .eliminated). Раніше клас додавався одразу, але сам
    // елемент лишався в сітці аж до кінця всього бою (renderDrawGrid()
    // викликався тільки у finishBattle()) — картка ставала невидимою
    // (opacity:0), та .tickets — це CSS-грід, тому порожнє місце під неї
    // так і лишалось зарезервованим до фіналу, і сітка "дірявіла" з кожним
    // вибулим учасником. Видалення з games + перерендер сітки одразу після
    // анімації прибирає цю порожню комірку й підтягує решту карток разом.
    setTimeout(() => {
      if (el) el.classList.add('eliminated');
      setTimeout(() => {
        games = games.filter(g => g.id !== b.gameId);
        renderDrawGrid();
        persist();
      }, 380);
    }, 550);
  }

  function battleFightLoop(ts) {
    if (!battleLastTs) battleLastTs = ts;
    const dt = Math.min(0.05, (ts - battleLastTs) / 1000);
    battleLastTs = ts;
    stepBattlePhysics(dt, true);

    const dead = battleBalls.filter(b => b.hp <= 0);
    if (dead.length) {
      dead.forEach(b => eliminateBattleBall(b));
      battleBalls = battleBalls.filter(b => b.hp > 0);
    }

    drawBattleFrame();

    if (battleBalls.length <= 1) {
      stopBattleLoop();
      finishBattle();
      return;
    }
    battleAnimId = requestAnimationFrame(battleFightLoop);
  }

  // Швидкість бою тепер завжди фіксована (висока, але не надмірна) — повзунок
  // тривалості для цього режиму прибрано з інтерфейсу, тому параметр не потрібен.
  function startBattle() {
    roundActive = true;
    startRoundBtn.disabled = true;
    backBtn.disabled = true;
    instantWinToggle.disabled = true;
    setStepperButtonsDisabled(true);
    setLogReturnButtonsDisabled(true);
    battleMachine.classList.add('active');
    updateStatus('Батл-рояль триває...', 'active');
    stopBattleLoop();
    syncBattleCanvasMetrics();
    initBattleBalls(BATTLE_SPEED_FIGHT_FACTOR);
    battleLastTs = null;
    battleAnimId = requestAnimationFrame(battleFightLoop);
  }

  function finishBattle() {
    roundActive = false;
    battleMachine.classList.remove('active');
    backBtn.disabled = false;
    setStepperButtonsDisabled(false);
    setLogReturnButtonsDisabled(false);
    renderDrawGrid();
    drawBattleFrame();
    const winner = games[0];
    if (winner) {
      logLine(`Переможець: <b>${Common.escapeHtml(winner.name)}</b>`, true);
      showFinishedState(winner);
    }
    persist();
  }

  // Для батл-рояля ховаємо повзунок тривалості раунду (замінений фіксованою
  // швидкістю) і перемикач "В один раунд" (тут завжди бій до останньої кульки).
  function updateBattleModeUI(active) {
    instantWinLabel.style.display = active ? 'none' : '';
    if (durationBlock) durationBlock.style.display = active ? 'none' : '';
  }

  // ---- Повільне "холосте" обертання колеса, поки раунд не запущено ----
  // Крутиться сам контейнер .wheel-stage (клас idle-spin, CSS-анімація),
  // тоді як сам раунд обертає інший елемент — #wheelSvg через inline
  // transform у spinWheel(). Тому дві анімації одна одній не заважають.
  function startWheelIdle() {
    wheelStage.classList.add('idle-spin');
    // У режимі очікування стрілка не показує "поточний" сектор (колесо не
    // крутиться цілеспрямовано до конкретної цілі) — повертаємо їй базовий
    // колір із CSS замість кольору сектора, на якому вона зупинилась раніше.
    if (wheelPointerEl) wheelPointerEl.style.borderRightColor = '';
  }
  function stopWheelIdle() {
    wheelStage.classList.remove('idle-spin');
  }

  // Читає РЕАЛЬНИЙ поточний кут повороту #wheelSvg безпосередньо з
  // обчисленого CSS-транформу (браузер сам інтерполює анімацію за
  // cubic-bezier — тому це набагато точніше й простіше, ніж намагатися
  // порахувати проміжний кут вручну за тим самим easing).
  function getSvgRotationDeg(el) {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 0;
    const m = t.match(/^matrix\(([^)]+)\)$/);
    if (!m) return 0;
    const v = m[1].split(',').map(Number);
    let deg = Math.atan2(v[1], v[0]) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }

  // Поки колесо крутиться, щокадрово визначає, який сектор зараз фактично
  // навпроти нерухомої стрілки (стрілка стоїть на екранному куті 0 — справа),
  // і фарбує стрілку в колір саме цього сектора. Цикл сам зупиняється, щойно
  // з .wheel-machine прибирають клас "spinning" (тобто обертання завершилось).
  function trackWheelArrowColor(entries, sectorAngle) {
    const wheelSvg = $('#wheelSvg');
    if (!wheelSvg || !wheelMachine.classList.contains('spinning')) return;
    const rotation = getSvgRotationDeg(wheelSvg);
    // Сектори намальовані у "сирих" (до повороту) координатах від -90°.
    // Точка, що зараз навпроти стрілки (екранний кут 0), у сирих координатах
    // лежить на куті (-rotation), зсунутому на +90° так само, як і в
    // формулі фінального повороту в spinWheel().
    const rawAngle = ((-rotation % 360) + 360) % 360;
    const adjusted = ((rawAngle + 90) % 360 + 360) % 360;
    const idx = Math.min(entries.length - 1, Math.floor(adjusted / sectorAngle));
    if (wheelPointerEl && entries[idx]) {
      wheelPointerEl.style.borderRightColor = Common.colorForGame(entries[idx]);
    }
    requestAnimationFrame(() => trackWheelArrowColor(entries, sectorAngle));
  }

  // Показує попап із результатом раунду і чекає, поки користувач сам
  // натисне "Прибрати" або "Залишити" — на відміну від попереднього
  // авто-приховування за таймером, тепер саме людина вирішує фінал раунду.
  function showWheelResultPopup(target, el) {
    wheelResultName.textContent = target.name;
    wheelResultPopup.classList.add('show');

    wheelKeepBtn.onclick = () => {
      wheelResultPopup.classList.remove('show');
      logLine(`Раунд ${roundCount}: <b>${Common.escapeHtml(target.name)}</b> — залишено в грі без змін`);
      afterRoundCleanup();
    };
    wheelRemoveBtn.onclick = () => {
      wheelResultPopup.classList.remove('show');
      finishRound(target, el);
    };
  }

  function setVisualMode(mode) {
    if (roundActive) return;
    visualMode = mode;
    const useWheel = mode === 'wheel';
    const useBattle = mode === 'battle';
    const useSlot = !useWheel && !useBattle;

    slotMachine.style.display = useSlot ? 'flex' : 'none';
    wheelMachine.style.display = useWheel ? 'flex' : 'none';
    battleMachine.style.display = useBattle ? 'flex' : 'none';

    slotViewBtn.classList.toggle('active', useSlot);
    slotViewBtn.setAttribute('aria-pressed', String(useSlot));
    wheelViewBtn.classList.toggle('active', useWheel);
    wheelViewBtn.setAttribute('aria-pressed', String(useWheel));
    battleViewBtn.classList.toggle('active', useBattle);
    battleViewBtn.setAttribute('aria-pressed', String(useBattle));

    updateBattleModeUI(useBattle);

    if (useWheel) {
      stopBattleLoop();
      // .wheel-machine могло бути display:none (0px) — перераховуємо доступний
      // розмір панелі, перш ніж малювати колесо в новий розмір .wheel-stage.
      syncWheelStageMetrics();
      renderWheel();
      startWheelIdle();
    } else if (useBattle) {
      stopWheelIdle();
      initBattleIdle();
    } else {
      stopWheelIdle();
      stopBattleLoop();
      // Вікно рулетки могло бути display:none (0px заввишки) — перераховуємо
      // висоту й перемальовуємо стрічку заново під фактичний розмір.
      initSlotIdle();
    }
    persist();
  }

  function updateStatus(text, mode) {
    // Виводить короткий текстовий статус; mode додає клас для різного кольору.
    statusLine.textContent = text;
    statusLine.className = 'status-line' + (mode ? ' ' + mode : '');
  }

  function buildLogLi(entry) {
    // Будує один рядок журналу; якщо запис стосується повного вилучення гри
    // (entry.canReturn), додає кнопку повернення цієї гри в пул розіграшу.
    const li = document.createElement('li');
    const textSpan = document.createElement('span');
    textSpan.className = 'log-text';
    textSpan.innerHTML = entry.text;
    li.appendChild(textSpan);
    if (entry.isWin) li.classList.add('win-line');
    if (entry.canReturn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'log-return-btn' + (entry.returned ? ' returned' : '');
      btn.textContent = entry.returned ? 'Повернуто' : '↺ Повернути';
      btn.disabled = !!entry.returned;
      btn.addEventListener('click', () => returnGameToPool(entry, btn));
      li.appendChild(btn);
    }
    return li;
  }

  function logLine(text, isWin, meta) {
    // Додає один запис до журналу; переможний запис виділяється окремим стилем.
    const entry = { text, isWin: !!isWin };
    if (meta) {
      entry.gameId = meta.gameId;
      entry.gameName = meta.gameName;
      entry.canReturn = true;
      entry.returned = false;
    }
    logEntries.push(entry);
    const li = buildLogLi(entry);
    logEl.appendChild(li);
    // .log має flex-direction:column-reverse (найновіший запис показується
    // зверху), тому scrollTop = scrollHeight насправді прокручує в
    // протилежний від потрібного бік і ховає щойно доданий запис.
    // scrollIntoView не залежить від цієї особливості — просто показує сам
    // новододаний елемент, тож працює коректно незалежно від напрямку.
    li.scrollIntoView({ block: 'nearest' });
    persist();
  }

  function renderLogFromEntries() {
    logEl.innerHTML = '';
    logEntries.forEach(entry => logEl.appendChild(buildLogLi(entry)));
    if (logEl.lastElementChild) logEl.lastElementChild.scrollIntoView({ block: 'nearest' });
  }

  function setLogReturnButtonsDisabled(disabled) {
    logEl.querySelectorAll('.log-return-btn:not(.returned)').forEach(btn => { btn.disabled = disabled; });
  }

  // Повертає раніше вилучену гру назад у пул розіграшу (з 1 копією). Якщо
  // розіграш вже було завершено (показано банер переможця), знімає це
  // завершення і знову дає змогу запускати раунди.
  function returnGameToPool(entry, btn) {
    if (roundActive || entry.returned) return;
    if (!games.some(g => g.id === entry.gameId)) {
      games.push({ id: entry.gameId, name: entry.gameName, copies: 1 });
    }
    entry.returned = true;

    winnerBanner.classList.remove('show');
    startRoundBtn.disabled = false;
    instantWinToggle.disabled = false;
    backBtn.disabled = false;

    renderDrawGrid();
    initSlotIdle();
    if (visualMode === 'wheel') startWheelIdle();
    if (visualMode === 'battle') initBattleIdle();
    updateStatus(`Готово до раунду ${roundCount + 1}. Залишилось ігор: ${games.length}.`);
    persist();

    btn.classList.add('returned');
    btn.disabled = true;
    btn.textContent = 'Повернуто';
  }

  function cardEl(id) {
    return drawTickets.querySelector(`.ticket[data-id="${id}"]`);
  }

  // Зважений вибір: гра з більшою кількістю копій має вищий шанс бути обраною цим викликом.
  function weightedPick() {
    const total = games.reduce((s, g) => s + g.copies, 0);
    let r = Math.random() * total;
    for (const g of games) {
      if (r < g.copies) return g;
      r -= g.copies;
    }
    return games[games.length - 1];
  }

  function slotItemHtml(g, isCenter) {
    return `<div class="slot-item${isCenter ? ' slot-item-center' : ''}"><span style="color:${isCenter ? '' : Common.colorForGame(g)}">${Common.escapeHtml(g.name)}</span></div>`;
  }

  // Пул для заповнення стрічки, де кожна копія кожної гри трапляється рівно
  // стільки разів, скільки копій є насправді (як і сектори колеса) — на
  // відміну від незалежних випадкових вибірок, тут гра з 1 копією не може
  // "випадково" з'явитися в стрічці кілька разів за один прохід пулу.
  function buildCopyPool() {
    return shuffle(games.flatMap(g => Array.from({ length: g.copies }, () => g)));
  }

  // Показує нерухому рулетку з поточними іграми перед запуском раунду.
  function initSlotIdle() {
    slotMachine.classList.remove('spinning', 'slot-landed');
    syncSlotWindowMetrics();
    const pool = slotOrder.length ? slotOrder : (games.length ? games : [{ name: '—' }]);
    const items = [];
    for (let i = 0; i < Math.max(slotRows, pool.length); i++) {
      items.push(pool[i % pool.length]);
    }
    const centerIndex = Math.min(Math.floor(slotRows / 2), items.length - 1);
    slotStrip.innerHTML = items.map((g, i) => slotItemHtml(g, i === centerIndex)).join('');
    slotStrip.style.transition = 'none';
    const ty = (SLOT_WINDOW_H / 2 - SLOT_ITEM_H / 2) - centerIndex * SLOT_ITEM_H;
    slotStrip.style.transform = `translateY(${ty}px)`;
  }

  // Запускає анімацію рулетки, зупиняє її на target і викликає onDone після зупинки.
  function spinSlot(target, durationSec, onDone) {
    slotMachine.classList.remove('slot-landed');
    slotMachine.classList.add('spinning');
    slotStrip.classList.add('spinning');
    syncSlotWindowMetrics();

    const halfRows = Math.floor(slotRows / 2);
    const itemsCount = Math.max(24, halfRows * 2 + 8, Math.min(280, Math.round(durationSec * 6)));
    // Позиція зупинки: рівно halfRows елементів має лишитись ПІСЛЯ target,
    // щоб вікно (яке тепер може бути й вищим за 3 ряди) було повністю
    // заповнене реальними елементами з обох боків від центру.
    const targetIndex = itemsCount - 1 - halfRows;
    const items = [];
    let pool = buildCopyPool();
    let poolIdx = 0;
    for (let i = 0; i < itemsCount; i++) {
      if (poolIdx >= pool.length) { pool = buildCopyPool(); poolIdx = 0; }
      items.push(pool[poolIdx++]);
    }
    items[targetIndex] = target;
    // Під час прокрутки жоден елемент НЕ позначається як "центральний"
    // (isCenter завжди false) — інакше переможний варіант отримував яскраву
    // підсвітку (клас slot-item-center) одразу при рендері стрічки, і його
    // було видно заздалегідь, ще коли він тільки пролітав повз вікно, а не
    // коли реально зупинився. Підсвітку додаємо точково нижче, в момент
    // реальної зупинки (slotAnim.onfinish).
    slotStrip.innerHTML = items.map((g) => slotItemHtml(g, false)).join('');

    slotStrip.style.transition = 'none';
    slotStrip.style.transform = 'translateY(0px)';
    // eslint-disable-next-line no-unused-expressions
    slotStrip.offsetHeight;

    const finalTy = (SLOT_WINDOW_H / 2 - SLOT_ITEM_H / 2) - targetIndex * SLOT_ITEM_H;

    // Двофазний рух через Web Animations API (element.animate) — звичайна
    // CSS-transition з одним easing на весь час не може дати "рівномірно
    // швидко, а гальмо тільки в кінці": один-єдиний cubic-bezier завжди
    // трохи уповільнює рух від самого початку. Тому рухом керують дві фази:
    //  1) 0 → (durationSec - DECEL_SEC) — линійний рух з постійною швидкістю
    //     (без жодного уповільнення), тобто "швидко з самого старту";
    //  2) останні DECEL_SEC секунд — плавне гальмування (криву можна
    //     підкрутити нижче) точно до цільового елемента.
    const DECEL_SEC = Math.min(1, durationSec / 2);
    const fastFraction = Math.max(0, (durationSec - DECEL_SEC) / durationSec);
    const midTy = finalTy * fastFraction;

    const slotAnim = slotStrip.animate([
      { transform: 'translateY(0px)', offset: 0, easing: 'linear' },
      { transform: `translateY(${midTy}px)`, offset: fastFraction, easing: 'cubic-bezier(0.11, 0.42, 0.2, 1)' },
      { transform: `translateY(${finalTy}px)`, offset: 1 }
    ], { duration: durationSec * 1000, fill: 'forwards' });

    setTimeout(() => {
      slotStrip.classList.remove('spinning');
    }, Math.max(0, durationSec * 1000 - 350));

    slotAnim.onfinish = () => {
      // "Запікаємо" фінальну позицію у звичайний inline transform і прибираємо
      // WAAPI-анімацію — далі код сторінки (idle-обертання, наступний раунд
      // тощо) знову керує slotStrip.style.transform напряму, як і раніше.
      slotAnim.cancel();
      slotStrip.style.transform = `translateY(${finalTy}px)`;
      // Підсвічуємо переможний елемент лише зараз, коли стрічка вже реально
      // зупинилась — а не раніше, під час прокрутки (див. коментар вище).
      const landedEl = slotStrip.children[targetIndex];
      if (landedEl) landedEl.classList.add('slot-item-center');
      slotMachine.classList.remove('spinning');
      slotMachine.classList.add('slot-landed');
      onDone(target);
    };
  }

  // Обертає колесо так, щоб один із секторів обраної гри зупинився під стрілкою.
  function spinWheel(target, durationSec, onDone) {
    // Записуємо в СПІЛЬНУ wheelEntries (а не лише в локальну змінну), щоб
    // після завершення раунду finishRound() міг прибрати з неї рівно один
    // (чи всі — для вибулої повністю/миттєвого переможця) запис виграної
    // гри й одразу перемалювати колесо — без повного перемішування решти
    // секторів і без ризику працювати зі застарілими даними.
    wheelEntries = shuffle(games.flatMap(g => Array.from({ length: g.copies }, () => g)));
    const entries = wheelEntries;
    const targetIndex = entries.findIndex(g => g.id === target.id);
    renderWheel(entries);
    const wheelSvg = $('#wheelSvg');
    const sectorAngle = 360 / entries.length;
    const turns = Math.max(4, Math.round(durationSec * 1.5));
    // Раніше колесо завжди зупинялось РІВНО по центру виграшного сектора
    // (+0.5 * sectorAngle) — через це, коли обертання вже помітно
    // сповільнювалось, можна було заздалегідь вгадати переможця, бо стрілка
    // щоразу приходила в одну й ту саму точку сектора. Тепер зупинка —
    // випадкова точка ВСЕРЕДИНІ сектора, майже впритул до країв (edgeMargin
    // зовсім невеликий — лишає буквально кілька пікселів запасу, щоб через
    // товщину самої стрілки та лінії між секторами не виникало візуальної
    // двозначності з сусіднім сектором), тому наперед вгадати результат
    // неможливо.
    const edgeMargin = 0.02; // відступ від країв сектора (частка sectorAngle)
    const randomFraction = edgeMargin + Math.random() * (1 - 2 * edgeMargin);
    // +90: стрілка тепер справа (кут 0), а сектори намальовані від кута -90
    // (згори) — тому потрібен зсув на чверть кола порівняно з попередньою
    // формулою, яка цілилась у верх (кут -90).
    const finalRotation = turns * 360 + 90 - (targetIndex + randomFraction) * sectorAngle;
    wheelMachine.classList.add('spinning');
    wheelSvg.style.transition = 'none';
    wheelSvg.style.transform = 'rotate(0deg)';
    wheelSvg.offsetHeight;
    requestAnimationFrame(() => {
      wheelSvg.style.transition = `transform ${durationSec}s cubic-bezier(0.15, 0.82, 0.22, 1)`;
      wheelSvg.style.transform = `rotate(${finalRotation}deg)`;
    });
    // Стрілка з самого початку обертання підсвічується кольором сектора, що
    // фактично навпроти неї в кожен момент часу (див. trackWheelArrowColor).
    requestAnimationFrame(() => trackWheelArrowColor(entries, sectorAngle));
    wheelSvg.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      wheelSvg.removeEventListener('transitionend', onEnd);
      wheelMachine.classList.remove('spinning');
      onDone(target);
    });
  }

  startRoundBtn.addEventListener('click', () => {
    if (roundActive || games.length < 2) return;
    if (visualMode === 'battle') {
      startBattle();
      return;
    }
    runRound(parseInt(durationRange.value, 10));
  });

  function runRound(durationSec) {
    // Блокує керування на час раунду, обирає ціль і запускає рулетку.
    roundActive = true;
    startRoundBtn.disabled = true;
    backBtn.disabled = true;
    instantWinToggle.disabled = true;
    setStepperButtonsDisabled(true);
    setLogReturnButtonsDisabled(true);
    roundCount++;
    updateStatus(`Раунд ${roundCount} триває...`, 'active');

    if (visualMode === 'wheel') {
      wheelResultPopup.classList.remove('show');
      stopWheelIdle();
    }

    // Раніше в звичайному режимі шанс не залежав від кількості копій
    // (uniformPick — кожна гра 1/N незалежно від copies), і лише миттєвий
    // режим ("В один раунд") ураховував копії. Тепер копії враховуються
    // завжди: більше копій — вищий шанс потрапити в раунд, як і має бути,
    // якщо копія = "додатковий квиток" гри в розіграші.
    const target = weightedPick();

    if (visualMode === 'wheel') {
      // Для колеса результат більше НЕ застосовується автоматично: після
      // зупинки показуємо попап і чекаємо, поки людина сама натисне
      // "Прибрати" чи "Залишити" (див. showWheelResultPopup).
      spinWheel(target, durationSec, () => {
        const el = cardEl(target.id);
        showWheelResultPopup(target, el);
      });
    } else {
      spinSlot(target, durationSec, () => {
        const el = cardEl(target.id);
        finishRound(target, el);
      });
    }
  }

  function finishRound(target, el) {
    // Якщо зараз показане колесо — прибираємо виграний сектор одразу, щойно
    // відомий результат раунду (а не чекаємо, поки перемалює наступний
    // spinWheel() на старті наступного раунду). Просто видаляємо потрібні
    // записи з wheelEntries (без повного перемішування), тому решта
    // секторів лишається на своїх місцях.
    if (visualMode === 'wheel') {
      if (instantWinMode) {
        wheelEntries = wheelEntries.filter(g => g.id === target.id);
      } else if (target.copies <= 1) {
        wheelEntries = wheelEntries.filter(g => g.id !== target.id);
      } else {
        const idx = wheelEntries.findIndex(g => g.id === target.id);
        if (idx !== -1) wheelEntries = wheelEntries.slice(0, idx).concat(wheelEntries.slice(idx + 1));
      }
      renderWheel(wheelEntries);
    }

    if (instantWinMode) {
      // Режим миттєвого переможця: обрана гра одразу стає фінальним переможцем,
      // усі інші ігри вилучаються одним раундом.
      if (el) el.classList.add('winner-picked');
      logLine(`Раунд ${roundCount}: <b>${Common.escapeHtml(target.name)}</b> — переможець обраний миттєво`, true);
      setTimeout(() => {
        games.forEach(g => {
          if (g.id !== target.id) {
            const otherEl = cardEl(g.id);
            if (otherEl) {
              const stamp = otherEl.querySelector('.stamp');
              if (stamp) stamp.classList.add('show');
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
    persist();

    if (el) el.classList.add('winner-picked');

    if (eliminatedFully) {
      logLine(`Раунд ${roundCount}: <b>${Common.escapeHtml(target.name)}</b> — вилучено повністю`, false, { gameId: target.id, gameName: target.name });
      if (el) {
        const stamp = el.querySelector('.stamp');
        if (stamp) stamp.classList.add('show');
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
      logLine(`Раунд ${roundCount}: <b>${Common.escapeHtml(target.name)}</b> — знято копію, залишилось ${target.copies}`);
      setTimeout(() => {
        if (el) {
          el.classList.remove('winner-picked');
          const badge = el.querySelector('.copies-badge');
          if (badge) badge.textContent = '× ' + target.copies;
        }
        afterRoundCleanup();
      }, 900);
    }
  }

  function setStepperButtonsDisabled(disabled) {
    drawTickets.querySelectorAll('.plus-btn').forEach(b => b.disabled = disabled);
    drawTickets.querySelectorAll('.minus-btn').forEach(b => {
      const id = Number(b.closest('.ticket').dataset.id);
      const g = games.find(x => x.id === id);
      b.disabled = disabled || !g || g.copies <= 1;
    });
  }

  function showSlotWinner(winner) {
    slotMachine.classList.remove('spinning');
    slotMachine.classList.add('slot-landed');
    slotStrip.classList.remove('spinning');
    syncSlotWindowMetrics();
    const centerIndex = Math.floor(slotRows / 2);
    const items = Array.from({ length: slotRows }, () => winner);
    slotStrip.innerHTML = items.map((g, i) => slotItemHtml(g, i === centerIndex)).join('');
    slotStrip.style.transition = 'none';
    const ty = (SLOT_WINDOW_H / 2 - SLOT_ITEM_H / 2) - centerIndex * SLOT_ITEM_H;
    slotStrip.style.transform = `translateY(${ty}px)`;
  }

  function showFinishedState(winner) {
    // Оформлює екран завершеного розіграшу: банер, підсвітку картки й нерухому рулетку.
    wheelResultPopup.classList.remove('show');
    stopWheelIdle();
    startRoundBtn.disabled = true;
    instantWinToggle.disabled = true;
    setStepperButtonsDisabled(true);
    updateStatus('Розіграш завершено.', 'win');
    winnerName.textContent = winner.name;
    winnerBanner.classList.add('show');
    const wc = cardEl(winner.id);
    if (wc) wc.classList.add('final-winner');
    showSlotWinner(winner);
  }

  function afterRoundCleanup() {
    roundActive = false;
    backBtn.disabled = false;
    setStepperButtonsDisabled(false);
    setLogReturnButtonsDisabled(false);

    if (games.length <= 1) {
      const winner = games[0];
      if (winner) {
        logLine(`Переможець: <b>${Common.escapeHtml(winner.name)}</b>`, true);
        showFinishedState(winner);
      }
    } else {
      startRoundBtn.disabled = false;
      instantWinToggle.disabled = false;
      updateStatus(`Готово до раунду ${roundCount + 1}. Залишилось ігор: ${games.length}.`);
      if (visualMode === 'wheel') startWheelIdle();
    }
    persist();
  }

  slotViewBtn.addEventListener('click', () => setVisualMode('slot'));
  wheelViewBtn.addEventListener('click', () => setVisualMode('wheel'));
  battleViewBtn.addEventListener('click', () => setVisualMode('battle'));
  shuffleVisualsBtn.addEventListener('click', () => {
    if (roundActive) return;
    if (visualMode === 'battle') { initBattleIdle(); return; }
    refreshVisualOrder();
    initSlotIdle();
    renderWheel();
  });

  // ---- Перерахунок розміру рулетки/колеса при зміні розміру вікна ----
  // .slot-window і .wheel-stage тепер динамічно заповнюють всю доступну
  // висоту панелі, тому кількість видимих рядів (слот) чи сторона квадрата
  // (колесо) може змінитись — перебудовуємо під нову висоту, інакше
  // центрування "попливе".
  // ВАЖЛИВО: тут навмисно window 'resize', а НЕ ResizeObserver на #drawPanel.
  // ResizeObserver, що стежить за #drawPanel, і калбек якого сам змінює
  // висоту нащадків (.slot-window/.wheel-stage) — на вузьких/планшетних
  // екранах, де #drawPanel не має власної фіксованої висоти,— це створює
  // зациклення: наш же перерахунок трохи змінює висоту #drawPanel, це знову
  // тригерить обсервер, і так по колу, через що сторінка нескінченно росла
  // вгору. window 'resize' реагує лише на реальну зміну розміру вікна
  // браузера і фізично не може самотригеритись від наших власних правок DOM.
  let slotResizeRaf = null;
  window.addEventListener('resize', () => {
    if (roundActive) return;
    if (slotResizeRaf) cancelAnimationFrame(slotResizeRaf);
    slotResizeRaf = requestAnimationFrame(() => {
      if (visualMode === 'wheel') {
        syncWheelStageMetrics();
        return;
      }
      if (visualMode === 'battle') {
        syncBattleCanvasMetrics();
        return;
      }
      if (visualMode !== 'slot') return;
      if (slotMachine.classList.contains('slot-landed') && games.length <= 1 && games[0]) {
        showSlotWinner(games[0]);
      } else {
        initSlotIdle();
      }
    });
  });

  // ---- Початкове відображення сторінки розіграшу ----
  function init() {
    instantWinToggle.checked = instantWinMode;
    instantWinLabel.classList.toggle('mode-active', instantWinMode);
    if (state.durationValue) {
      durationRange.value = state.durationValue;
      durVal.textContent = durationRange.value + ' сек';
    }

    renderDrawGrid();
    setVisualMode(visualMode);
    initSlotIdle();
    renderLogFromEntries();

    if (games.length <= 1) {
      const winner = games[0];
      if (winner) showFinishedState(winner);
    } else {
      updateStatus(`Готово до раунду ${roundCount + 1}. Залишилось ігор: ${games.length}.`);
      startRoundBtn.disabled = false;
      backBtn.disabled = false;
      instantWinToggle.disabled = false;
    }
  }

  init();
})();