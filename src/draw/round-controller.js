const transitions = {
  idle: new Set(['animating', 'finished']),
  animating: new Set(['resolving', 'idle']),
  resolving: new Set(['idle', 'finished']),
  finished: new Set(['idle'])
};

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export class RoundController {
  constructor({ selectTarget, visualizationFor, commitResult, onPhaseChange, onError, initialPhase = 'idle' }) {
    this.selectTarget = selectTarget;
    this.visualizationFor = visualizationFor;
    this.commitResult = commitResult;
    this.onPhaseChange = onPhaseChange;
    this.onError = onError;
    if (!transitions[initialPhase]) throw new Error(`Unknown initial round phase: ${initialPhase}`);
    this.phase = initialPhase;
    this.internalController = null;
    this.activeVisualization = null;
    this.removeExternalAbortListener = null;
  }

  transition(nextPhase) {
    if (nextPhase === this.phase) return;
    if (!transitions[this.phase]?.has(nextPhase)) {
      throw new Error(`Invalid round transition: ${this.phase} -> ${nextPhase}`);
    }
    this.phase = nextPhase;
    this.onPhaseChange(nextPhase);
  }

  async start({ mode, games, durationMs, signal }) {
    if (this.phase === 'finished') this.transition('idle');
    if (this.phase !== 'idle') throw new Error('ROUND_ACTIVE');
    if (signal?.aborted) throw abortError();

    const target = this.selectTarget(games);
    const visualization = this.visualizationFor(mode);
    const internalController = new AbortController();
    this.internalController = internalController;
    this.activeVisualization = visualization;

    if (signal) {
      const mirrorAbort = () => this.cancel();
      signal.addEventListener('abort', mirrorAbort, { once: true });
      this.removeExternalAbortListener = () => signal.removeEventListener('abort', mirrorAbort);
    }

    this.transition('animating');
    try {
      const result = await visualization.play({
        target,
        games,
        durationMs,
        signal: internalController.signal
      });
      if (internalController.signal.aborted) throw abortError();

      this.transition('resolving');
      const commit = await this.commitResult(result);
      this.transition(commit?.finished ? 'finished' : 'idle');
      this.cleanupActiveRound();
      return result;
    } catch (error) {
      this.activeVisualization?.cancel();
      if (this.phase !== 'idle') this.transition('idle');
      this.cleanupActiveRound();
      if (isAbortError(error) || internalController.signal.aborted) throw abortError();
      this.onError(error);
      throw error;
    }
  }

  cancel() {
    if (this.phase === 'idle') return;
    this.internalController?.abort();
    this.activeVisualization?.cancel();
    this.transition('idle');
    this.cleanupActiveRound();
  }

  finish() {
    if (this.phase !== 'idle') throw new Error(`Cannot finish round from ${this.phase}`);
    this.transition('finished');
  }

  cleanupActiveRound() {
    this.removeExternalAbortListener?.();
    this.removeExternalAbortListener = null;
    this.internalController = null;
    this.activeVisualization = null;
  }
}
