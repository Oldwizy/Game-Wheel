export function shouldPreserveActiveVisualization({ phase, mode, cardsHasProgress }) {
  return (phase !== 'idle' && phase !== 'finished') || (mode === 'cards' && cardsHasProgress);
}
