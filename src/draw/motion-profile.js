const MAX_SUSPENSE_TAIL_MS = 9000;
const MIN_ACCELERATION_FRACTION = 0.12;

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

export function suspenseTailMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError('Animation duration must be positive');
  }
  return Math.min(
    durationMs * 0.6,
    3000 + durationMs * 0.2,
    MAX_SUSPENSE_TAIL_MS
  );
}

export function velocityProfileForDuration(durationMs) {
  return {
    acceleration: MIN_ACCELERATION_FRACTION,
    deceleration: suspenseTailMs(durationMs) / durationMs
  };
}

export function velocityAt(progress, { acceleration = 0.12, deceleration = 0.25 } = {}) {
  if (progress <= 0) return 0;
  if (progress < acceleration) return smoothstep(progress / acceleration);
  const decelerationStart = 1 - deceleration;
  if (progress <= decelerationStart) return 1;
  if (progress < 1) return 1 - smoothstep((progress - decelerationStart) / deceleration);
  return 0;
}

export function createProgressKeyframes({ durationMs, samples = 120, profile } = {}) {
  const resolvedProfile = profile ?? velocityProfileForDuration(durationMs);
  const sampleCount = Math.max(2, Math.floor(samples));
  const cumulative = [0];
  let total = 0;
  for (let index = 1; index <= sampleCount; index += 1) {
    const previousOffset = (index - 1) / sampleCount;
    const offset = index / sampleCount;
    total += (velocityAt(previousOffset, resolvedProfile) + velocityAt(offset, resolvedProfile)) / (2 * sampleCount);
    cumulative.push(total);
  }
  if (total <= 0) throw new RangeError('Animation velocity profile has no travel distance');

  return {
    profile: resolvedProfile,
    keyframes: cumulative.map((distance, index) => ({
      offset: index / sampleCount,
      progress: index === sampleCount ? 1 : distance / total
    }))
  };
}
