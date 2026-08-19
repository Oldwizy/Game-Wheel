export const PALETTE_COLORS = ['#E85D5D', '#4ECDC4', '#FFB347', '#7C8CFF', '#C67CFF', '#69B56B', '#5DC8E8', '#FF8FB1', '#F2C14E', '#F2955A'];

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function normalizeName(name) {
  return String(name).trim().replace(/\s+/g, ' ');
}

export function colorForGame(game) {
  return PALETTE_COLORS[game.id % PALETTE_COLORS.length];
}

export function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

export function formatSavedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
