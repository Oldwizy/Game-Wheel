const PALETTE = ['#E85D5D', '#4ECDC4', '#FFB347', '#7C8CFF', '#C67CFF', '#69B56B', '#5DC8E8', '#FF8FB1', '#F2C14E', '#F2955A'];
const DEFAULT_CONFIG = {
  hpOverride: null,
  hitCooldownMs: 350,
  damageMin: 6,
  damageMax: 14
};

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function destroyedError() {
  const error = new Error('Battle visualization has been destroyed');
  error.code = 'VISUALIZATION_DESTROYED';
  return error;
}

function rgba(hex, alpha) {
  const value = hex.replace('#', '');
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

export function ballHp(game) {
  return 100 + Math.max(0, game.copies - 1) * 5;
}

export function ballRadius(hp) {
  return Math.max(20, Math.min(52, 16 + Math.sqrt(hp) * 2.6));
}

export function createBalls({
  games,
  width,
  height,
  speedFactor,
  random = Math.random,
  hpOverride = null
}) {
  const speed = Math.hypot(width, height) * speedFactor;
  const balls = [];
  for (const game of games) {
    const hp = Number.isFinite(hpOverride) && hpOverride > 0 ? hpOverride : ballHp(game);
    const radius = ballRadius(hp);
    const minX = radius;
    const maxX = Math.max(radius, width - radius);
    const minY = radius;
    const maxY = Math.max(radius, height - radius);
    let x = minX;
    let y = minY;
    let attempts = 0;
    do {
      x = minX + random() * (maxX - minX);
      y = minY + random() * (maxY - minY);
      attempts += 1;
    } while (attempts < 30 && balls.some(ball => Math.hypot(ball.x - x, ball.y - y) < ball.r + radius + 4));
    const angle = random() * Math.PI * 2;
    balls.push({
      gameId: game.id,
      name: game.name,
      color: PALETTE[game.id % PALETTE.length],
      hp,
      maxHp: hp,
      r: radius,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed
    });
  }
  return balls;
}

export function stepPhysics(state, dt, {
  dealDamage = true,
  random = Math.random,
  now = 0,
  hitCooldownMs = DEFAULT_CONFIG.hitCooldownMs,
  damageMin = DEFAULT_CONFIG.damageMin,
  damageMax = DEFAULT_CONFIG.damageMax
} = {}) {
  const clampedDt = Math.min(0.05, Math.max(0, dt));
  const balls = state.balls.map(ball => ({ ...ball }));
  const cooldowns = new Map(state.cooldowns ?? []);

  for (const ball of balls) {
    ball.x += ball.vx * clampedDt;
    ball.y += ball.vy * clampedDt;
    if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= -1; }
    if (ball.x + ball.r > state.width) { ball.x = state.width - ball.r; ball.vx *= -1; }
    if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy *= -1; }
    if (ball.y + ball.r > state.height) { ball.y = state.height - ball.r; ball.vy *= -1; }
    ball.x = Math.max(Math.min(ball.r, state.width - ball.r), Math.min(Math.max(ball.r, state.width - ball.r), ball.x));
    ball.y = Math.max(Math.min(ball.r, state.height - ball.r), Math.min(Math.max(ball.r, state.height - ball.r), ball.y));
  }

  for (let leftIndex = 0; leftIndex < balls.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < balls.length; rightIndex += 1) {
      const left = balls[leftIndex];
      const right = balls[rightIndex];
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const minimumDistance = left.r + right.r;
      if (distance >= minimumDistance) continue;

      const overlap = (minimumDistance - distance) / 2;
      const normalX = dx / distance;
      const normalY = dy / distance;
      left.x -= normalX * overlap;
      left.y -= normalY * overlap;
      right.x += normalX * overlap;
      right.y += normalY * overlap;
      const leftNormalVelocity = left.vx * normalX + left.vy * normalY;
      const rightNormalVelocity = right.vx * normalX + right.vy * normalY;
      left.vx += (rightNormalVelocity - leftNormalVelocity) * normalX;
      left.vy += (rightNormalVelocity - leftNormalVelocity) * normalY;
      right.vx += (leftNormalVelocity - rightNormalVelocity) * normalX;
      right.vy += (leftNormalVelocity - rightNormalVelocity) * normalY;

      if (dealDamage) {
        const pairKey = left.gameId < right.gameId
          ? `${left.gameId}_${right.gameId}`
          : `${right.gameId}_${left.gameId}`;
        const lastHit = cooldowns.get(pairKey) ?? -Infinity;
        if (now - lastHit >= hitCooldownMs) {
          cooldowns.set(pairKey, now);
          const damage = damageMin + random() * (damageMax - damageMin);
          left.hp -= damage;
          right.hp -= damage;
        }
      }
    }
  }

  return { ...state, dt: clampedDt, balls, cooldowns };
}

function validatedConfig(config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const hpOverride = Number.isFinite(merged.hpOverride) && merged.hpOverride > 0
    ? merged.hpOverride
    : null;
  const hitCooldownMs = Number.isFinite(merged.hitCooldownMs) && merged.hitCooldownMs >= 0
    ? merged.hitCooldownMs
    : DEFAULT_CONFIG.hitCooldownMs;
  const damageMin = Number.isFinite(merged.damageMin) && merged.damageMin > 0
    ? merged.damageMin
    : DEFAULT_CONFIG.damageMin;
  const damageMax = Number.isFinite(merged.damageMax) && merged.damageMax >= damageMin
    ? merged.damageMax
    : Math.max(DEFAULT_CONFIG.damageMax, damageMin);
  return { hpOverride, hitCooldownMs, damageMin, damageMax };
}

export function createBattleVisualization(elements, {
  random = Math.random,
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
  now = () => performance.now(),
  battleConfig
} = {}) {
  const config = validatedConfig(battleConfig);
  let canvas = elements.canvas;
  let context = null;
  let state = { width: 160, height: 160, balls: [], cooldowns: new Map() };
  let lastGames = [];
  let lastTimestamp = null;
  let frameId = null;
  let loopKind = null;
  let pendingPlay = null;
  let destroyed = false;

  function throwIfDestroyed() {
    if (destroyed) throw destroyedError();
  }

  function syncCanvas() {
    const width = Math.max(160, elements.machine?.clientWidth || 160);
    const height = Math.max(160, elements.machine?.clientHeight || 160);
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context = canvas.getContext('2d');
    context?.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    state = { ...state, width, height };
  }

  function drawFrame() {
    if (!context) return;
    context.clearRect(0, 0, state.width, state.height);
    for (const ball of state.balls) {
      context.beginPath();
      context.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      context.fillStyle = rgba(ball.color, 0.85);
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = ball.color;
      context.stroke();

      const hpFraction = Math.max(0, ball.hp / ball.maxHp);
      context.beginPath();
      context.arc(ball.x, ball.y, ball.r + 4, -Math.PI / 2, -Math.PI / 2 + hpFraction * Math.PI * 2);
      context.strokeStyle = hpFraction > 0.3 ? '#4ECDC4' : '#E85D5D';
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = '#EDEFF2';
      context.font = `${Math.max(9, Math.min(13, ball.r * 0.42))}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const maxCharacters = Math.max(4, Math.floor(ball.r / 3));
      const label = ball.name.length > maxCharacters
        ? `${ball.name.slice(0, maxCharacters - 1)}…`
        : ball.name;
      context.fillText(label, ball.x, ball.y);
    }
  }

  function clearFrame() {
    if (frameId === null) return;
    cancelFrame(frameId);
    frameId = null;
  }

  function schedule(callback) {
    frameId = requestFrame(timestamp => {
      frameId = null;
      callback(timestamp);
    });
  }

  function idleFrame(timestamp) {
    if (loopKind !== 'idle') return;
    if (lastTimestamp === null) lastTimestamp = timestamp;
    state = stepPhysics(state, (timestamp - lastTimestamp) / 1000, {
      dealDamage: false,
      random,
      now: now()
    });
    lastTimestamp = timestamp;
    drawFrame();
    schedule(idleFrame);
  }

  function settlePlay(result, error) {
    const pending = pendingPlay;
    pendingPlay = null;
    loopKind = null;
    lastTimestamp = null;
    pending?.removeAbortListener?.();
    elements.machine?.classList?.remove('active');
    if (!pending) return;
    error ? pending.reject(error) : pending.resolve(result);
  }

  function fightFrame(timestamp) {
    if (loopKind !== 'fight' || !pendingPlay) return;
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const dealDamage = pendingPlay.warmupFrames === 0;
    pendingPlay.warmupFrames = Math.max(0, pendingPlay.warmupFrames - 1);
    state = stepPhysics(state, (timestamp - lastTimestamp) / 1000, {
      dealDamage,
      random,
      now: now(),
      hitCooldownMs: config.hitCooldownMs,
      damageMin: config.damageMin,
      damageMax: config.damageMax
    });
    lastTimestamp = timestamp;

    let dead = state.balls.filter(ball => ball.hp <= 0);
    if (dead.length === state.balls.length && state.balls.length > 0) {
      const survivor = state.balls.at(-1);
      survivor.hp = Math.max(1, survivor.hp);
      dead = dead.filter(ball => ball.gameId !== survivor.gameId);
    }
    for (const ball of dead) {
      if (!pendingPlay.eliminatedIds.includes(ball.gameId)) pendingPlay.eliminatedIds.push(ball.gameId);
    }
    if (dead.length > 0) {
      const deadIds = new Set(dead.map(ball => ball.gameId));
      state = { ...state, balls: state.balls.filter(ball => !deadIds.has(ball.gameId)) };
    }
    drawFrame();

    if (state.balls.length <= 1) {
      const survivorId = state.balls[0]?.gameId ?? null;
      settlePlay({
        kind: 'battle-complete',
        eliminatedIds: [...pendingPlay.eliminatedIds],
        survivorId
      });
      return;
    }
    schedule(fightFrame);
  }

  function render(model) {
    throwIfDestroyed();
    if (pendingPlay) throw new Error('BATTLE_PLAY_ACTIVE');
    clearFrame();
    lastGames = [...model.games];
    syncCanvas();
    state = {
      width: state.width,
      height: state.height,
      balls: createBalls({
        games: lastGames,
        width: state.width,
        height: state.height,
        speedFactor: 0.055,
        random,
        hpOverride: config.hpOverride
      }),
      cooldowns: new Map()
    };
    elements.machine?.classList?.remove('active');
    drawFrame();
    if (state.balls.length > 0) {
      loopKind = 'idle';
      lastTimestamp = null;
      schedule(idleFrame);
    }
  }

  async function play({ games = lastGames, signal }) {
    throwIfDestroyed();
    if (pendingPlay) throw new Error('BATTLE_PLAY_ACTIVE');
    if (signal?.aborted) throw abortError();
    clearFrame();
    syncCanvas();
    lastGames = [...games];
    state = {
      width: state.width,
      height: state.height,
      balls: createBalls({
        games,
        width: state.width,
        height: state.height,
        speedFactor: 0.13,
        random: config.hpOverride === null ? random : () => 0,
        hpOverride: config.hpOverride
      }),
      cooldowns: new Map()
    };
    drawFrame();
    elements.machine?.classList?.add('active');
    loopKind = 'fight';
    lastTimestamp = null;

    return new Promise((resolve, reject) => {
      const handleAbort = () => cancel();
      if (signal) signal.addEventListener('abort', handleAbort, { once: true });
      pendingPlay = {
        resolve,
        reject,
        eliminatedIds: [],
        warmupFrames: config.hpOverride === null ? 0 : 8,
        removeAbortListener: signal
          ? () => signal.removeEventListener('abort', handleAbort)
          : null
      };
      if (state.balls.length <= 1) {
        settlePlay({ kind: 'battle-complete', eliminatedIds: [], survivorId: state.balls[0]?.gameId ?? null });
      } else {
        schedule(fightFrame);
      }
    });
  }

  function cancel() {
    if (destroyed) return;
    clearFrame();
    loopKind = null;
    lastTimestamp = null;
    state = { ...state, cooldowns: new Map() };
    if (pendingPlay) settlePlay(null, abortError());
  }

  function destroy() {
    if (destroyed) return;
    cancel();
    context = null;
    canvas = null;
    state = { width: 0, height: 0, balls: [], cooldowns: new Map() };
    lastGames = [];
    destroyed = true;
  }

  return { render, play, cancel, destroy };
}
