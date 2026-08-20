import { loadState, saveState } from '../core/state.js';
import { weightedPick } from '../core/random.js';
import { changeCopies, findTerminalWinner, removeRoundCopy, resolveInstantWinner, returnGame } from '../core/game-rules.js';
import { createBattleVisualization } from './battle.js';
import { applyControlState, controlStateForPhase } from './controls.js';
import { createDrawListView } from './draw-list-view.js';
import { createDrawLog } from './draw-log.js';
import { RoundController } from './round-controller.js';
import { createSlotVisualization } from './slot.js';
import { createWheelVisualization } from './wheel.js';

const byId = id => document.getElementById(id);
const elements = {
  drawTickets: byId('drawTickets'),
  back: byId('backBtn'),
  modeButtons: [byId('slotViewBtn'), byId('wheelViewBtn'), byId('battleViewBtn')],
  slotMode: byId('slotViewBtn'),
  wheelMode: byId('wheelViewBtn'),
  battleMode: byId('battleViewBtn'),
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
  wheelPopup: byId('wheelResultPopup'),
  wheelName: byId('wheelResultName'),
  wheelKeep: byId('wheelKeepBtn'),
  wheelRemove: byId('wheelRemoveBtn'),
  battleMachine: byId('battleMachine'),
  battleCanvas: byId('battleCanvas'),
  winnerBanner: byId('winnerBanner'),
  winnerName: byId('winnerName'),
  log: byId('log'),
  participantsTab: byId('participantsTabBtn'),
  historyTab: byId('historyTabBtn')
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
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const localTestConfig = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? window.__GAME_WHEEL_TEST__?.battle
    : undefined;

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
  const battle = createBattleVisualization({
    machine: elements.battleMachine,
    canvas: elements.battleCanvas
  }, { battleConfig: localTestConfig });

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

  const visualizations = { slot, wheel, battle };
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
      logReturnButtons: elements.log.querySelectorAll('.log-return-btn'),
      wheelDecisionButtons: [elements.wheelKeep, elements.wheelRemove]
    }, disabled);
    drawList.setDisabled(disabled.copies);
    drawLog.setReturnDisabled(disabled.logReturn);
    elements.wheelPopup.classList.toggle('show', phase === 'awaiting-wheel-decision');
    if (phase === 'awaiting-wheel-decision' && provisionalTarget) elements.wheelName.textContent = provisionalTarget.name;
  }

  function renderMode() {
    const mode = state.visualMode;
    elements.slotMachine.style.display = mode === 'slot' ? 'flex' : 'none';
    elements.wheelMachine.style.display = mode === 'wheel' ? 'flex' : 'none';
    elements.battleMachine.style.display = mode === 'battle' ? 'flex' : 'none';
    elements.modeButtons.forEach(button => {
      const selected = button.id.startsWith(mode);
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const battleMode = mode === 'battle';
    elements.instantLabel.style.display = battleMode ? 'none' : '';
    elements.durationBlock.style.display = battleMode ? 'none' : '';
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
    elements.durationValue.textContent = `${state.durationValue} сек`;
    if (!preserveActiveVisualization) renderMode();
    else if (state.visualMode === 'wheel') wheel.render({ games: state.games });
    renderPhase(controller.phase);
  }

  function persistAndRender(options) {
    persist();
    renderState(options);
  }

  function hideFinishedState() {
    elements.winnerBanner.classList.remove('show');
    elements.drawTickets.querySelectorAll('.final-winner').forEach(card => card.classList.remove('final-winner'));
  }

  function showFinishedState(winner) {
    elements.winnerName.textContent = winner.name;
    elements.winnerBanner.classList.add('show');
    drawList.markWinner(winner.id);
    updateStatus('Розіграш завершено.', 'win');
  }

  async function commitResult(result) {
    const target = provisionalTarget && state.games.find(game => game.id === provisionalTarget.id);
    if (result.kind === 'battle-complete') {
      let games = state.games;
      for (const id of result.eliminatedIds) {
        const eliminated = games.find(game => game.id === id);
        if (!eliminated) continue;
        state.roundCount += 1;
        addLog(`Раунд ${state.roundCount}: <b>${eliminated.name}</b> — вибув з бою (HP вичерпано)`, false, {
          gameId: eliminated.id,
          gameName: eliminated.name
        });
        games = games.filter(game => game.id !== id);
        wheel.reconcile(games, { type: 'remove-game', gameId: id });
      }
      state = { ...state, games };
      const winner = games.find(game => game.id === result.survivorId) ?? games[0];
      if (winner) addLog(`Переможець: <b>${winner.name}</b>`, true);
      persistAndRender({ preserveActiveVisualization: true });
      if (winner) showFinishedState(winner);
      return { finished: true };
    }

    if (!target) throw new RangeError(`Unknown committed target ${result.targetId}`);
    state.roundCount += 1;
    if (result.kind === 'wheel-complete' && result.decision === 'keep') {
      addLog(`Раунд ${state.roundCount}: <b>${target.name}</b> — залишено в грі без змін`);
    } else if (state.instantWinMode) {
      const resolved = resolveInstantWinner(state.games, target.id);
      state = { ...state, games: resolved.games };
      if (result.kind === 'wheel-complete') {
        wheel.reconcile(state.games, { type: 'landed-remove', index: result.landedSectorIndex });
      } else {
        for (const id of resolved.eliminatedIds) wheel.reconcile(state.games, { type: 'remove-game', gameId: id });
      }
      addLog(`Раунд ${state.roundCount}: <b>${target.name}</b> — переможець обраний миттєво`, true);
    } else {
      const removed = removeRoundCopy(state.games, target.id);
      state = { ...state, games: removed.games };
      wheel.reconcile(state.games, result.kind === 'wheel-complete'
        ? { type: 'landed-remove', index: result.landedSectorIndex }
        : { type: removed.eliminated ? 'remove-game' : 'decrease', gameId: target.id });
      addLog(
        removed.eliminated
          ? `Раунд ${state.roundCount}: <b>${target.name}</b> — вилучено повністю`
          : `Раунд ${state.roundCount}: <b>${target.name}</b> — знято копію, залишилось ${removed.target.copies}`,
        false,
        removed.eliminated ? { gameId: target.id, gameName: target.name } : null
      );
    }

    const winner = findTerminalWinner(state.games);
    if (winner && !state.logEntries.at(-1)?.text.startsWith('Переможець:')) addLog(`Переможець: <b>${winner.name}</b>`, true);
    persistAndRender({ preserveActiveVisualization: true });
    if (winner) showFinishedState(winner);
    else updateStatus(`Готово до раунду ${state.roundCount + 1}. Залишилось ігор: ${state.games.length}.`);
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
  elements.battleMode.addEventListener('click', () => setMode('battle'));
  elements.duration.addEventListener('input', () => { elements.durationValue.textContent = `${elements.duration.value} сек`; });
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
    updateStatus(state.visualMode === 'battle' ? 'Батл-рояль триває...' : `Раунд ${state.roundCount + 1} триває...`, 'active');
    controller.start({
      mode: state.visualMode,
      games: state.games,
      durationMs: Number(state.durationValue) * 1000
    }).catch(error => { if (error.name !== 'AbortError') console.error(error); });
  });
  elements.participantsTab.addEventListener('click', () => setSideTab('participants'));
  elements.historyTab.addEventListener('click', () => setSideTab('history'));
  elements.wheelKeep.addEventListener('click', () => controller.decideWheel('keep'));
  elements.wheelRemove.addEventListener('click', () => controller.decideWheel('remove'));
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
  }, { once: true });

  renderState();
  setSideTab('participants');
  if (loadError) updateStatus('Збережений стан було відновлено з помилкою.');
  else updateStatus(`Готово до раунду ${state.roundCount + 1}. Залишилось ігор: ${state.games.length}.`);
}