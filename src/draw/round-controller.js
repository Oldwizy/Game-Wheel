const transitions = {
  idle: new Set(['animating']),
  animating: new Set(['awaiting-wheel-decision', 'resolving', 'idle']),
  'awaiting-wheel-decision': new Set(['resolving', 'idle']),
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
  constructor({ selectTarget, visualizationFor, commitResult, onPhaseChange, onError }) {
    this.selectTarget = selectTarget;
    this.visualizationFor = visualizationFor;
    this.commitResult = commitResult;
    this.onPhaseChange = onPhaseChange;
    this.onError = onError;
    this.phase = 'idle';
    this.internalController = null;
    this.activeVisualization = null;
    this.provisionalResult = null;
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

      if (mode === 'wheel') {
        this.provisionalResult = result;
        this.transition('awaiting-wheel-decision');
        return result;
      }

      this.transition('resolving');
      const commit = await this.commitResult(result);
      this.transition(commit?.finished ? 'finished' : 'idle');
      this.cleanupActiveRound();
      return result;
    } catch (error) {
      this.activeVisualization?.cancel();
      this.provisionalResult = null;
      if (this.phase !== 'idle') this.transition('idle');
      this.cleanupActiveRound();
      if (isAbortError(error) || internalController.signal.aborted) throw abortError();
      this.onError(error);
      throw error;
    }
  }

  async decideWheel(decision) {
    if (decision !== 'keep' && decision !== 'remove') {
      throw new TypeError(`Unknown Wheel decision: ${decision}`);
    }
    if (this.phase !== 'awaiting-wheel-decision' || !this.provisionalResult) {
      throw new Error('NO_WHEEL_DECISION_PENDING');
    }

    const result = { ...this.provisionalResult, decision };
    try {
      this.transition('resolving');
      const commit = await this.commitResult(result);
      this.provisionalResult = null;
      this.transition(commit?.finished ? 'finished' : 'idle');
      this.cleanupActiveRound();
      return result;
    } catch (error) {
      this.provisionalResult = null;
      if (this.phase !== 'idle') this.transition('idle');
      this.cleanupActiveRound();
      if (isAbortError(error) || this.internalController?.signal.aborted) throw abortError();
      this.onError(error);
      throw error;
    }
  }

  cancel() {
    if (this.phase === 'idle') return;
    this.internalController?.abort();
    this.activeVisualization?.cancel();
    this.provisionalResult = null;
    this.transition('idle');
    this.cleanupActiveRound();
  }

  cleanupActiveRound() {
    this.removeExternalAbortListener?.();
    this.removeExternalAbortListener = null;
    this.internalController = null;
    this.activeVisualization = null;
  }
}
