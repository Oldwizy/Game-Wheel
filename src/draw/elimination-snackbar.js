export const ELIMINATION_SNACKBAR_DURATION_MS = 2000;

export function eliminationSnackbarContent(gameName) {
  return { label: 'Вибув:', name: String(gameName) };
}

export function showEliminationSnackbar(container, gameName, { durationMs = ELIMINATION_SNACKBAR_DURATION_MS } = {}) {
  if (!container) return;

  const content = eliminationSnackbarContent(gameName);
  const snackbar = container.ownerDocument.createElement('div');
  snackbar.className = 'elimination-snackbar';
  snackbar.setAttribute('role', 'status');
  const label = container.ownerDocument.createElement('span');
  label.className = 'elimination-snackbar-label';
  label.textContent = content.label;
  const name = container.ownerDocument.createElement('span');
  name.className = 'elimination-snackbar-name';
  name.textContent = content.name;
  snackbar.append(label, name);
  container.append(snackbar);

  window.setTimeout(() => snackbar.remove(), durationMs);
}
