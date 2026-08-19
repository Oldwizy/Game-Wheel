export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function fixCircularAdjacency(result, keyFn) {
  const length = result.length;
  if (length < 3 || keyFn(result[0]) !== keyFn(result[length - 1])) return;

  for (let index = 1; index < length - 1; index += 1) {
    const candidate = result[index];
    const tail = result[length - 1];
    if (keyFn(candidate) === keyFn(tail)) continue;

    const previousAcceptsTail = keyFn(result[index - 1]) !== keyFn(tail);
    const nextAcceptsTail = index + 1 < length - 1
      ? keyFn(result[index + 1]) !== keyFn(tail)
      : true;
    const tailPreviousAcceptsCandidate = keyFn(result[length - 2]) !== keyFn(candidate);
    const firstAcceptsCandidate = keyFn(result[0]) !== keyFn(candidate);
    if (previousAcceptsTail && nextAcceptsTail && tailPreviousAcceptsCandidate && firstAcceptsCandidate) {
      result[index] = tail;
      result[length - 1] = candidate;
      return;
    }
  }
}

export function shuffleNoAdjacent(items, keyFn, options = {}, random = Math.random) {
  if (items.length <= 1) return [...items];

  const groups = new Map();
  items.forEach(item => {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  groups.forEach((group, key) => groups.set(key, shuffle(group, random)));

  const result = [];
  let lastKey = options.avoidFirstKey ?? null;
  for (let index = 0; index < items.length; index += 1) {
    const candidates = [...groups.entries()].filter(([, group]) => group.length > 0);
    const alternatives = candidates.filter(([key]) => key !== lastKey);
    const pool = alternatives.length > 0 ? alternatives : candidates;
    const largestGroup = Math.max(...pool.map(([, group]) => group.length));
    const tied = pool.filter(([, group]) => group.length === largestGroup);
    const [key, group] = tied[Math.floor(random() * tied.length)];
    result.push(group.shift());
    lastKey = key;
  }

  if (options.circular) fixCircularAdjacency(result, keyFn);
  return result;
}

export function weightedPick(games, random = Math.random) {
  const tickets = games.map(game => (
    Number.isInteger(game.copies) && game.copies > 0 ? game.copies : 0
  ));
  const total = tickets.reduce((sum, count) => sum + count, 0);
  if (total === 0) throw new RangeError('Cannot pick from an empty ticket pool');

  const ticket = random() * total;
  let boundary = 0;
  for (let index = 0; index < games.length; index += 1) {
    boundary += tickets[index];
    if (ticket < boundary) return games[index];
  }
  return games[games.length - 1];
}
