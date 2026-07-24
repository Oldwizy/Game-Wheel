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
  const instantWinToggle = $('#instantWinToggle');
  const instantWinLabel = $('#instantWinLabel');

  // Розміри елементів рулетки — потрібні для точного положення стрічки.
  const SLOT_ITEM_H = 56;
  const SLOT_ROWS = 5;
  const SLOT_WINDOW_H = SLOT_ITEM_H * SLOT_ROWS;

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
      const fontSize = Math.max(3.5, Math.min(12, labelLength / Math.max(1, game.name.length * 0.58), labelAngleWidth * 0.72));
      const estimatedWidth = game.name.length * fontSize * 0.58;
      const textLength = Math.min(labelLength, estimatedWidth);
      return `<path d="${wheelSectorPath(center, center, radius, start, end)}" fill="${Common.colorForGame(game)}" fill-opacity="0.82" stroke="#12161B" stroke-width="1"></path><g transform="rotate(${mid} ${center} ${center})"><text class="wheel-label" style="font-size:${fontSize.toFixed(2)}px" x="${center + labelStart + labelLength / 2}" y="${center}" textLength="${textLength.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${label}</text></g>`;
    }).join('');
    wheelStage.innerHTML = `<svg id="wheelSvg" viewBox="0 0 ${size} ${size}" aria-hidden="true">${sectors}<circle class="wheel-hub" cx="${center}" cy="${center}" r="23"></circle><circle fill="var(--amber)" cx="${center}" cy="${center}" r="7"></circle></svg>`;
    return entries;
  }

  function setVisualMode(mode) {
    if (roundActive) return;
    visualMode = mode;
    const useWheel = mode === 'wheel';
    slotMachine.style.display = useWheel ? 'none' : 'block';
    wheelMachine.style.display = useWheel ? 'block' : 'none';
    slotViewBtn.classList.toggle('active', !useWheel);
    slotViewBtn.setAttribute('aria-pressed', String(!useWheel));
    wheelViewBtn.classList.toggle('active', useWheel);
    wheelViewBtn.setAttribute('aria-pressed', String(useWheel));
    if (useWheel) renderWheel();
    persist();
  }

  function updateStatus(text, mode) {
    // Виводить короткий текстовий статус; mode додає клас для різного кольору.
    statusLine.textContent = text;
    statusLine.className = 'status-line' + (mode ? ' ' + mode : '');
  }

  function logLine(text, isWin) {
    // Додає один запис до журналу; переможний запис виділяється окремим стилем.
    logEntries.push({ text, isWin: !!isWin });
    const li = document.createElement('li');
    li.innerHTML = text;
    if (isWin) li.classList.add('win-line');
    logEl.appendChild(li);
    logEl.scrollTop = logEl.scrollHeight;
    persist();
  }

  function renderLogFromEntries() {
    logEl.innerHTML = '';
    logEntries.forEach(entry => {
      const li = document.createElement('li');
      li.innerHTML = entry.text;
      if (entry.isWin) li.classList.add('win-line');
      logEl.appendChild(li);
    });
    logEl.scrollTop = logEl.scrollHeight;
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

  // Рівноймовірний вибір: кожна гра має однаковий шанс потрапити в раунд незалежно
  // від кількості копій.
  function uniformPick() {
    return games[Math.floor(Math.random() * games.length)];
  }

  function slotItemHtml(g) {
    return `<div class="slot-item"><span style="color:${Common.colorForGame(g)}">${Common.escapeHtml(g.name)}</span></div>`;
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
    const pool = slotOrder.length ? slotOrder : (games.length ? games : [{ name: '—' }]);
    const items = [];
    for (let i = 0; i < Math.max(SLOT_ROWS, pool.length); i++) {
      items.push(pool[i % pool.length]);
    }
    const centerIndex = Math.min(Math.floor(SLOT_ROWS / 2), items.length - 1);
    slotStrip.innerHTML = items.map(slotItemHtml).join('');
    slotStrip.style.transition = 'none';
    const ty = (SLOT_WINDOW_H / 2 - SLOT_ITEM_H / 2) - centerIndex * SLOT_ITEM_H;
    slotStrip.style.transform = `translateY(${ty}px)`;
  }

  // Запускає анімацію рулетки, зупиняє її на target і викликає onDone після зупинки.
  function spinSlot(target, durationSec, onDone) {
    slotMachine.classList.remove('slot-landed');
    slotMachine.classList.add('spinning');
    slotStrip.classList.add('spinning');

    const itemsCount = Math.max(24, Math.min(160, Math.round(durationSec * 3)));
    const targetIndex = itemsCount - 3;
    const items = [];
    let pool = buildCopyPool();
    let poolIdx = 0;
    for (let i = 0; i < itemsCount; i++) {
      if (poolIdx >= pool.length) { pool = buildCopyPool(); poolIdx = 0; }
      items.push(pool[poolIdx++]);
    }
    items[targetIndex] = target;

    slotStrip.innerHTML = items.map(slotItemHtml).join('');

    slotStrip.style.transition = 'none';
    slotStrip.style.transform = 'translateY(0px)';
    // eslint-disable-next-line no-unused-expressions
    slotStrip.offsetHeight;

    const finalTy = (SLOT_WINDOW_H / 2 - SLOT_ITEM_H / 2) - targetIndex * SLOT_ITEM_H;

    requestAnimationFrame(() => {
      slotStrip.style.transition = `transform ${durationSec}s cubic-bezier(0.15, 0.82, 0.22, 1)`;
      slotStrip.style.transform = `translateY(${finalTy}px)`;
    });

    setTimeout(() => {
      slotStrip.classList.remove('spinning');
    }, Math.max(0, durationSec * 1000 - 350));

    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      slotStrip.removeEventListener('transitionend', onEnd);
      slotMachine.classList.remove('spinning');
      slotMachine.classList.add('slot-landed');
      onDone(target);
    };
    slotStrip.addEventListener('transitionend', onEnd);
  }

  // Обертає колесо так, щоб один із секторів обраної гри зупинився під стрілкою.
  function spinWheel(target, durationSec, onDone) {
    const entries = shuffle(games.flatMap(g => Array.from({ length: g.copies }, () => g)));
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
    wheelSvg.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      wheelSvg.removeEventListener('transitionend', onEnd);
      wheelMachine.classList.remove('spinning');
      onDone(target);
    });
  }

  startRoundBtn.addEventListener('click', () => {
    if (roundActive || games.length < 2) return;
    runRound(parseInt(durationRange.value, 10));
  });

  function runRound(durationSec) {
    // Блокує керування на час раунду, обирає ціль і запускає рулетку.
    roundActive = true;
    startRoundBtn.disabled = true;
    backBtn.disabled = true;
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

  function finishRound(target, el) {
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
      logLine(`Раунд ${roundCount}: <b>${Common.escapeHtml(target.name)}</b> — вилучено повністю`);
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
    const items = [winner, winner, winner];
    slotStrip.innerHTML = items.map(slotItemHtml).join('');
    slotStrip.style.transition = 'none';
    const ty = (SLOT_WINDOW_H / 2 - SLOT_ITEM_H / 2) - 1 * SLOT_ITEM_H;
    slotStrip.style.transform = `translateY(${ty}px)`;
  }

  function showFinishedState(winner) {
    // Оформлює екран завершеного розіграшу: банер, підсвітку картки й нерухому рулетку.
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
    }
    persist();
  }

  slotViewBtn.addEventListener('click', () => setVisualMode('slot'));
  wheelViewBtn.addEventListener('click', () => setVisualMode('wheel'));
  shuffleVisualsBtn.addEventListener('click', () => {
    if (roundActive) return;
    refreshVisualOrder();
    initSlotIdle();
    renderWheel();
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