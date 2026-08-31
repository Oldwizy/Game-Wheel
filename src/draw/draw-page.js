import { loadState, saveState } from '../core/state.js';
import { weightedPick } from '../core/random.js';
import { changeCopies, findTerminalWinner, removeRoundCopy, resolveInstantWinner, returnGame } from '../core/game-rules.js';
import { applyControlState, controlStateForPhase } from './controls.js';
import { createDrawListView } from './draw-list-view.js';
import { createDrawLog } from './draw-log.js';
import { createMysteryVisualization } from './mystery.js';
import { RoundController } from './round-controller.js';
import { createSlotVisualization } from './slot.js';
import { createWheelVisualization } from './wheel.js';

const byId = id => document.getElementById(id);
const totalCopies = games => games.reduce((total, game) => total + game.copies, 0);
const elements = {
  drawTickets: byId('drawTickets'),
  back: byId('backBtn'),
  modeButtons: [byId('slotViewBtn'), byId('wheelViewBtn'), byId('mysteryViewBtn')],
  slotMode: byId('slotViewBtn'),
  wheelMode: byId('wheelViewBtn'),
  mysteryMode: byId('mysteryViewBtn'),
  instant: byId('instantWinToggle'),
  instantLabel: byId('instantWinLabel'),
  duration: byId('durationRange'),
  durationBlock: document.querySelector('.duration-block'),
  durationValue: byId('durVal'),
  status: byId('statusLine'),
  start: byId('startRoundBtn'),
  shuffle: byId('shuffleVisualsBtn'),
  slotMachine: byId('slotMachine'),
  slotWindow: document.querySelector('.slot-window'),
  slotStrip: byId('slotStrip'),
  wheelMachine: byId('wheelMachine'),
  wheelStage: byId('wheelStage'),
  wheelPointer: document.querySelector('.wheel-pointer'),
  mysteryMachine: byId('mysteryMachine'),
  mysteryStrip: byId('mysteryStrip'),
  mysteryResult: byId('mysteryResult'),
  resultPopup: byId('drawResultPopup'),
  resultPopupTitle: byId('drawResultTitle'),
  resultPopupName: byId('drawResultName'),
  resultPopupClose: byId('drawResultCloseBtn'),
  log: byId('log'),
  participantsTab: byId('participantsTabBtn'),
  historyTab: byId('historyTabBtn'),
  participantsSection: byId('participantsSection'),
  participantsDrawer: byId('participantsDrawer')
};

let { value: state, error: loadError } = loadState(localStorage);
if (state.games.length === 0) {
  window.location.href = 'index.html';
} else {
  startDrawPage();
}

function startDrawPage() {
  let provisionalTarget = null;
  let destroyed = false;
  const resultPopupQueue = [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobileLayout = matchMedia('(max-width: 640px)');
  const syncParticipantDrawer = event => { elements.participantsDrawer.open = !event.matches; };
  syncParticipantDrawer(mobileLayout);
  mobileLayout.addEventListener?.('change', syncParticipantDrawer);
  const slot = createSlotVisualization({
    machine: elements.slotMachine,
    window: elements.slotWindow,
    strip: elements.slotStrip
  }, { prefersReducedMotion: reducedMotion });
  const wheel = createWheelVisualization({
    machine: elements.wheelMachine,
    stage: elements.wheelStage,
    pointer: elements.wheelPointer
  }, { prefersReducedMotion: reducedMotion });
  const mystery = createMysteryVisualization({
    machine: elements.mysteryMachine,
    strip: elements.mysteryStrip,
    result: elements.mysteryResult
  }, { prefersReducedMotion: reducedMotion });
  wheel.initialize(state.games);

  const drawList = createDrawListView(elements.drawTickets, {
    onCopyDelta(id, delta) {
      if (controller.phase !== 'idle' && controller.phase !== 'finished') return;
      const before = state.games.find(game => game.id === id);
      if (!before) return;
      state = { ...state, games: changeCopies(state.games, id, delta) };
      wheel.reconcile(state.games, { type: delta > 0 ? 'increase' : 'decrease', gameId: id });
      hideFinishedState();
      persistAndRender();
    }
  });

  fetch('src/data/metacritic-games.json')
    .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
    .then(games => {
      drawList.setCatalog(games);
      mystery.setCatalog(games);
      renderState({ preserveActiveVisualization: true });
    })
    .catch(() => {});

  const drawLog = createDrawLog(elements.log, {
    onReturn(entry) {
      if (entry.returned || (controller.phase !== 'idle' && controller.phase !== 'finished')) return;
      state = { ...state, games: returnGame(state.games, entry) };
      entry.returned = true;
      wheel.reconcile(state.games, { type: 'increase', gameId: entry.gameId });
      hideFinishedState();
      persistAndRender();
      renderPhase('idle');
    }
  });

  const visualizations = { slot, wheel, mystery };
  const controller = new RoundController({
    selectTarget(games) {
      provisionalTarget = weightedPick(games);
      return provisionalTarget;
    },
    visualizationFor: mode => visualizations[mode],
    commitResult,
    onPhaseChange: renderPhase,
    onError(error) {
      updateStatus(`Помилка раунду: ${error.message}`);
    }
  });

  function addLog(text, isWin = false, meta = null) {
    const entry = { text, isWin };
    if (meta) Object.assign(entry, meta, { canReturn: true, returned: false });
    state.logEntries = [...state.logEntries, entry];
  }

  function persist() {
    const result = saveState(localStorage, state);
    if (result.error) updateStatus('Не вдалося зберегти стан локально.');
  }

  function updateStatus(text, mode = '') {
    elements.status.textContent = text;
    elements.status.className = `status-line${mode ? ` ${mode}` : ''}`;
  }

  function roundStatus(phase) {
    return `Раунд ${state.roundCount + 1} ${phase}. Варіантів: ${state.games.length}. Усього з копіями: ${totalCopies(state.games)}.`;
  }

  function renderPhase(phase) {
    const disabled = controlStateForPhase(phase);
    applyControlState({
      modeButtons: elements.modeButtons,
      shuffle: elements.shuffle,
      copySteppers: elements.drawTickets.querySelectorAll('.step-btn'),
      duration: elements.duration,
      instant: elements.instant,
      start: elements.start,
      back: elements.back,
      logReturnButtons: elements.log.querySelectorAll('.log-return-btn')
    }, disabled);
    drawList.setDisabled(disabled.copies);
    drawLog.setReturnDisabled(disabled.logReturn);
  }

  function renderMode() {
    const mode = state.visualMode;
    const mysteryMode = mode === 'mystery';
    elements.slotMachine.style.display = mode === 'slot' ? 'flex' : 'none';
    elements.wheelMachine.style.display = mode === 'wheel' ? 'flex' : 'none';
    elements.mysteryMachine.style.display = mysteryMode ? 'flex' : 'none';
    elements.participantsSection.hidden = mysteryMode;
    elements.modeButtons.forEach(button => {
      const selected = button.id.startsWith(mode);
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    Object.entries(visualizations).forEach(([name, visualization]) => {
      if (name !== mode) visualization.cancel();
    });
    visualizations[mode].render({ games: state.games });
  }

  function renderState({ preserveActiveVisualization = false } = {}) {
    drawList.render(state.games, { disabled: controller.phase !== 'idle' });
    drawLog.render(state.logEntries);
    elements.instant.checked = state.instantWinMode;
    elements.instantLabel.classList.toggle('mode-active', state.instantWinMode);
    elements.duration.value = String(state.durationValue);
    elements.durationValue.textContent = `${state.durationValue} с`;
    if (!preserveActiveVisualization) renderMode();
    else if (state.visualMode === 'wheel') wheel.render({ games: state.games });
    renderPhase(controller.phase);
  }

  function persistAndRender(options) {
    persist();
    renderState(options);
  }

  function hideFinishedState() {
    resultPopupQueue.length = 0;
    elements.resultPopup.hidden = true;
    elements.drawTickets.querySelectorAll('.final-winner').forEach(card => card.classList.remove('final-winner'));
  }

  function showFinishedState(winner) {
    drawList.markWinner(winner.id);
    updateStatus('Розіграш завершено.', 'win');
  }

  function showNextResultPopup() {
    if (!elements.resultPopup.hidden || resultPopupQueue.length === 0) return;
    const result = resultPopupQueue.shift();
    elements.resultPopupTitle.textContent = result.title;
    elements.resultPopupName.textContent = result.name;
    elements.resultPopup.hidden = false;
    elements.resultPopupClose.focus();
  }

  function queueResultPopup(title, name) {
    resultPopupQueue.push({ title, name });
    showNextResultPopup();
  }

  async function commitResult(result) {
    const target = provisionalTarget && state.games.find(game => game.id === provisionalTarget.id);
    if (!target) throw new RangeError(`Unknown committed target ${result.targetId}`);
    let eliminatedNames = [];
    state.roundCount += 1;
    if (state.instantWinMode) {
      const resolved = resolveInstantWinner(state.games, target.id);
      eliminatedNames = resolved.eliminatedIds
        .map(id => state.games.find(game => game.id === id)?.name)
        .filter(Boolean);
      state = { ...state, games: resolved.games };
      if (result.kind === 'wheel-complete') {
        wheel.reconcile(state.games, { type: 'landed-remove', index: result.landedSectorIndex });
      } else {
        for (const id of resolved.eliminatedIds) wheel.reconcile(state.games, { type: 'remove-game', gameId: id });
      }
      addLog(`Раунд ${state.roundCount}: <b>${target.name}</b> — переможця обрано миттєво`, true);
    } else {
      const removed = removeRoundCopy(state.games, target.id);
      state = { ...state, games: removed.games };
      if (removed.eliminated) eliminatedNames = [target.name];
      wheel.reconcile(state.games, result.kind === 'wheel-complete'
        ? { type: 'landed-remove', index: result.landedSectorIndex }
        : { type: removed.eliminated ? 'remove-game' : 'decrease', gameId: target.id });
      addLog(
        removed.eliminated
          ? `Раунд ${state.roundCount}: варіант <b>${target.name}</b> вилучено повністю`
          : `Раунд ${state.roundCount}: для <b>${target.name}</b> знято копію; лишилося копій: ${removed.target.copies}`,
        false,
        removed.eliminated ? { gameId: target.id, gameName: target.name } : null
      );
    }

    const winner = findTerminalWinner(state.games);
    if (winner && !state.logEntries.at(-1)?.text.startsWith('Переможець:')) addLog(`Переможець: <b>${winner.name}</b>`, true);
    persistAndRender({ preserveActiveVisualization: true });
    if (eliminatedNames.length) {
      queueResultPopup(
        eliminatedNames.length === 1 ? 'Вибуває з розіграшу' : 'Вибули з розіграшу',
        eliminatedNames.join(' · ')
      );
    }
    if (winner) queueResultPopup('Переможець', winner.name);
    if (winner) showFinishedState(winner);
    else updateStatus(roundStatus('готовий'));
    return { finished: Boolean(winner) };
  }

  function setSideTab(tab) {
    const showParticipants = tab === 'participants';
    elements.drawTickets.hidden = !showParticipants;
    elements.log.hidden = showParticipants;
    elements.participantsTab.classList.toggle('active', showParticipants);
    elements.participantsTab.setAttribute('aria-pressed', String(showParticipants));
    elements.historyTab.classList.toggle('active', !showParticipants);
    elements.historyTab.setAttribute('aria-pressed', String(!showParticipants));
  }

  function setMode(mode, save = true) {
    if (controller.phase !== 'idle' && controller.phase !== 'finished') return;
    state = { ...state, visualMode: mode };
    renderMode();
    renderPhase(controller.phase);
    if (save) persist();
  }

  elements.slotMode.addEventListener('click', () => setMode('slot'));
  elements.wheelMode.addEventListener('click', () => setMode('wheel'));
  elements.mysteryMode.addEventListener('click', () => setMode('mystery'));
  elements.duration.addEventListener('input', () => { elements.durationValue.textContent = `${elements.duration.value} с`; });
  elements.duration.addEventListener('change', () => {
    state = { ...state, durationValue: Number(elements.duration.value) };
    persist();
  });
  elements.instant.addEventListener('change', () => {
    state = { ...state, instantWinMode: elements.instant.checked };
    elements.instantLabel.classList.toggle('mode-active', state.instantWinMode);
    persist();
  });
  elements.shuffle.addEventListener('click', () => {
    if (controller.phase !== 'idle' && controller.phase !== 'finished') return;
    if (state.visualMode === 'wheel') wheel.shuffle();
    else visualizations[state.visualMode].render({ games: state.games });
  });
  elements.start.addEventListener('click', () => {
    if (state.games.length < 2) return;
    updateStatus(roundStatus('триває'), 'active');
    controller.start({
      mode: state.visualMode,
      games: state.games,
      durationMs: Number(state.durationValue) * 1000
    }).catch(error => { if (error.name !== 'AbortError') console.error(error); });
  });
  elements.participantsTab.addEventListener('click', () => setSideTab('participants'));
  elements.historyTab.addEventListener('click', () => setSideTab('history'));
  elements.resultPopupClose.addEventListener('click', () => {
    elements.resultPopup.hidden = true;
    showNextResultPopup();
  });
  elements.back.addEventListener('click', () => {
    if (controller.phase !== 'idle' && controller.phase !== 'finished') return;
    persist();
    location.href = 'index.html';
  });
  window.addEventListener('pagehide', () => {
    if (destroyed) return;
    destroyed = true;
    controller.cancel();
    Object.values(visualizations).forEach(visualization => visualization.destroy());
    drawList.destroy();
    drawLog.destroy();
    mobileLayout.removeEventListener?.('change', syncParticipantDrawer);
  }, { once: true });

  renderState();
  setSideTab('participants');
  if (loadError) updateStatus('Не вдалося повністю відновити збережений стан.');
  else updateStatus(roundStatus('готовий'));
}
