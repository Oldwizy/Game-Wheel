import { normalizeName } from '../shared/presentation.js';

const RESULT_LIMIT = 8;

export function searchGames(games, query) {
  const normalizedQuery = normalizeName(query).toLocaleLowerCase('uk');
  if (!normalizedQuery) return [];
  return games
    .map(game => {
      const titleIndex = game.title.toLocaleLowerCase('uk').indexOf(normalizedQuery);
      const alias = game.aliases?.find(value => value.toLocaleLowerCase('uk').includes(normalizedQuery));
      const aliasIndex = alias?.toLocaleLowerCase('uk').indexOf(normalizedQuery) ?? -1;
      const index = titleIndex >= 0 ? titleIndex : aliasIndex;
      return { game, index, alias: titleIndex < 0 ? alias : null };
    })
    .filter(result => result.index >= 0)
    .sort((left, right) => left.index - right.index || left.game.title.localeCompare(right.game.title))
    .slice(0, RESULT_LIMIT);
}

export function createGameAutocomplete({ input, list }) {
  let games = [];
  let results = [];
  let activeIndex = -1;

  function close() {
    results = [];
    activeIndex = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function select(game) {
    input.value = game.title;
    close();
  }

  function render() {
    results = searchGames(games, input.value);
    activeIndex = -1;
    list.replaceChildren(...results.map((result, index) => {
      const { game } = result;
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'game-suggestion';
      option.id = `gameSuggestion${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const image = document.createElement('img');
      image.src = game.image;
      image.alt = '';
      image.loading = 'lazy';
      image.width = 36;
      image.height = 54;
      const title = document.createElement('span');
      title.textContent = result.alias ? `${game.title} · ${result.alias}` : game.title;
      option.append(image, title);
      option.addEventListener('mousedown', event => {
        event.preventDefault();
        select(game);
      });
      return option;
    }));
    list.hidden = results.length === 0;
    input.setAttribute('aria-expanded', String(results.length > 0));
  }

  function setActive(index) {
    activeIndex = (index + results.length) % results.length;
    [...list.children].forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
    });
    input.setAttribute('aria-activedescendant', `gameSuggestion${activeIndex}`);
    list.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function onKeydown(event) {
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      select(results[activeIndex].game);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('keydown', onKeydown);
  input.addEventListener('blur', () => setTimeout(close, 120));

  return {
    setGames(nextGames) { games = Array.isArray(nextGames) ? nextGames : []; },
    destroy() {
      input.removeEventListener('input', render);
      input.removeEventListener('focus', render);
      input.removeEventListener('keydown', onKeydown);
      close();
    }
  };
}
