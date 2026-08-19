function safeLogMarkup(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('&lt;b&gt;', '<b>')
    .replaceAll('&lt;/b&gt;', '</b>');
}

export function createDrawLog(element, { onReturn }) {
  let entries = [];
  let returnDisabled = false;

  function buildEntry(entry, index) {
    const item = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'log-text';
    text.innerHTML = safeLogMarkup(entry.text);
    item.appendChild(text);
    if (entry.isWin) item.classList.add('win-line');

    if (entry.canReturn) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `log-return-btn${entry.returned ? ' returned' : ''}`;
      button.dataset.logIndex = String(index);
      button.textContent = entry.returned ? 'Повернуто' : '↺ Повернути';
      button.disabled = Boolean(entry.returned || returnDisabled);
      item.appendChild(button);
    }
    return item;
  }

  function render(nextEntries) {
    entries = [...nextEntries];
    element.replaceChildren(...entries.map(buildEntry));
    element.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }

  function append(entry) {
    entries.push(entry);
    const item = buildEntry(entry, entries.length - 1);
    element.appendChild(item);
    item.scrollIntoView({ block: 'nearest' });
  }

  function setReturnDisabled(disabled) {
    returnDisabled = disabled;
    element.querySelectorAll('.log-return-btn:not(.returned)').forEach(button => {
      button.disabled = disabled;
    });
  }

  function handleClick(event) {
    const button = event.target.closest('.log-return-btn');
    if (!button || !element.contains(button) || button.disabled) return;
    const index = Number(button.dataset.logIndex);
    const entry = entries[index];
    if (entry) onReturn(entry, index);
  }

  element.addEventListener('click', handleClick);
  return {
    render,
    append,
    setReturnDisabled,
    destroy() {
      element.removeEventListener('click', handleClick);
      entries = [];
    }
  };
}
