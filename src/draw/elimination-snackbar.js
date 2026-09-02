export function formatEliminationSnackbar(gameName) {
  return String(gameName);
}

export function showEliminationSnackbar(container, gameName, { durationMs = 7000 } = {}) {
  if (!container) return;

  const snackbar = container.ownerDocument.createElement('div');
  snackbar.className = 'elimination-snackbar';
  snackbar.setAttribute('role', 'status');
  snackbar.textContent = formatEliminationSnackbar(gameName);
  container.append(snackbar);

  window.setTimeout(() => snackbar.remove(), durationMs);
}
