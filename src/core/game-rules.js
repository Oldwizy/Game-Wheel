function findGame(games, id) {
  const game = games.find(candidate => candidate.id === id);
  if (!game) throw new RangeError(`Unknown game ${id}`);
  return game;
}

export function changeCopies(games, id, delta) {
  const target = findGame(games, id);
  if (!Number.isInteger(delta)) throw new TypeError('Copy delta must be an integer');
  const copies = target.copies + delta;
  if (copies <= 0) return games.filter(game => game.id !== id);
  return games.map(game => game.id === id ? { ...game, copies } : game);
}

export function removeRoundCopy(games, targetId) {
  const target = findGame(games, targetId);
  const copies = target.copies - 1;
  return {
    games: copies > 0
      ? games.map(game => game.id === targetId ? { ...game, copies } : game)
      : games.filter(game => game.id !== targetId),
    target: { ...target, copies: Math.max(0, copies) },
    eliminated: copies === 0
  };
}

export function resolveInstantWinner(games, targetId) {
  const target = findGame(games, targetId);
  return {
    games: [{ ...target }],
    target: { ...target },
    eliminatedIds: games.filter(game => game.id !== targetId).map(game => game.id)
  };
}

export function returnGame(games, entry) {
  const existing = games.find(game => game.id === entry.gameId);
  if (existing) {
    return games.map(game => game.id === entry.gameId
      ? { ...game, copies: game.copies + 1 }
      : game);
  }
  if (!Number.isInteger(entry.gameId) || entry.gameId <= 0 || typeof entry.gameName !== 'string' || !entry.gameName.trim()) {
    throw new TypeError('Returned game entry is invalid');
  }
  return [...games, { id: entry.gameId, name: entry.gameName, copies: 1 }];
}

export function findTerminalWinner(games) {
  return games.length === 1 ? games[0] : null;
}
