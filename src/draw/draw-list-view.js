import { colorForGame, hexToRgba } from '../shared/presentation.js';

export function createDrawListView(element, { onCopyDelta }) {
  let games = [];
  let disabled = false;

  function render(nextGames, options = {}) {
    games = [...nextGames];
    disabled = Boolean(options.disabled ?? disabled);
    const nodes = games.map((game, index) => {
      const card = document.createElement('div');
      card.className = 'ticket';
      card.dataset.id = String(game.id);
      const color = colorForGame(game);
      card.style.borderLeft = `3px solid ${color}`;
      card.style.background = `linear-gradient(90deg, ${hexToRgba(color, 0.10)}, transparent 60%), var(--panel-raised)`;

      const stamp = document.createElement('div');
      stamp.className = 'stamp';
      stamp.textContent = 'ВИЛУЧЕНО';
      const number = document.createElement('div');
      number.className = 'tnum';
      number.style.color = color;
      number.textContent = ` №${String(index + 1).padStart(2, '0')}`;
      const name = document.createElement('div');
      name.className = 'tname';
      name.textContent = game.name;
      const row = document.createElement('div');
      row.className = 'trow';
      const stepper = document.createElement('div');
      stepper.className = 'copies-stepper';
      const minus = document.createElement('button');
      minus.className = 'step-btn minus-btn';
      minus.type = 'button';
      minus.dataset.delta = '-1';
      minus.setAttribute('aria-label', 'Менше копій');
      minus.textContent = '−';
      minus.disabled = disabled || game.copies <= 1;
      const badge = document.createElement('span');
      badge.className = 'copies-badge';
      badge.style.borderColor = hexToRgba(color, 0.55);
      badge.style.color = color;
      badge.textContent = `× ${game.copies}`;
      const plus = document.createElement('button');
      plus.className = 'step-btn plus-btn';
      plus.type = 'button';
      plus.dataset.delta = '1';
      plus.setAttribute('aria-label', 'Більше копій');
      plus.textContent = '+';
      plus.disabled = disabled;
      stepper.append(minus, badge, plus);
      row.append(stepper, document.createElement('span'));
      card.append(stamp, number, name, row);
      return card;
    });
    element.replaceChildren(...nodes);
  }

  function setDisabled(nextDisabled) {
    disabled = nextDisabled;
    element.querySelectorAll('.step-btn').forEach(button => {
      const game = games.find(candidate => candidate.id === Number(button.closest('.ticket').dataset.id));
      button.disabled = disabled || (button.classList.contains('minus-btn') && game?.copies <= 1);
    });
  }

  function handleClick(event) {
    const button = event.target.closest('.step-btn');
    if (!button || button.disabled || !element.contains(button)) return;
    onCopyDelta(Number(button.closest('.ticket').dataset.id), Number(button.dataset.delta));
  }

  function markWinner(id) { element.querySelector(`.ticket[data-id="${id}"]`)?.classList.add('final-winner'); }
  function markEliminated(id) { element.querySelector(`.ticket[data-id="${id}"] .stamp`)?.classList.add('show'); }
  element.addEventListener('click', handleClick);
  return {
    render,
    setDisabled,
    markWinner,
    markEliminated,
    destroy() { element.removeEventListener('click', handleClick); games = []; }
  };
}
