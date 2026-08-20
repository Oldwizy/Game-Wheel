# Game Wheel Modular Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic Game Wheel scripts with tested native ES modules, preserving the current UI and rules while fixing Wheel reshuffles, transform jumps, Slot velocity discontinuities, and incomplete lifecycle cleanup.

**Architecture:** Pure core modules own versioned state, randomness, and game rules. A round controller owns phase transitions and commits; Slot, Wheel, and Battle implementations conform to one cancellable visualization interface and never mutate application state. Static HTML imports the modules directly, so production remains a build-free GitHub Pages site.

**Tech Stack:** Native browser ES modules, JavaScript with JSDoc contracts, Vitest, Playwright, npm, GitHub Actions, static GitHub Pages hosting.

**Spec:** `docs/superpowers/specs/2026-08-19-modular-refactor-design.md`

## Global Constraints

- Keep the existing `index.html` and `draw.html` user flows and visual design.
- Keep the application framework-free and backend-free.
- Publish directly as static HTML, CSS, and JavaScript at `https://oldwizy.github.io/Game-Wheel/`.
- Require no production build step. GitHub Pages serves the source modules directly.
- Development tooling may use Node.js, Vitest, Playwright, and GitHub Actions.
- Target current evergreen browsers that support native ES modules and the Web Animations API.
- Preserve the current `lototron_state_v1`, `lototron_history_v1`, and `twitch_token_v1` localStorage keys.
- Preserve weighted selection semantics: each copy contributes one ticket.
- Preserve Slot, Wheel, Battle Royale, instant-winner, history, return-to-pool, and Twitch flows.
- Direct `file://` execution is not required; local verification uses HTTP on port 4173.
- Do not commit `.serena/`, `node_modules/`, Playwright reports, screenshots, traces, or test-result directories.

## Target File Map

```text
src/
├── core/
│   ├── state.js              # schemas, migrations, storage, history
│   ├── random.js             # injectable shuffle/no-adjacent/weighted pick
│   └── game-rules.js         # immutable copy/elimination/winner operations
├── build/
│   ├── build-page.js         # index.html coordinator and entry point
│   └── game-list-view.js     # build-list and history DOM rendering
├── draw/
│   ├── draw-page.js          # draw.html coordinator and entry point
│   ├── round-controller.js   # phase machine and provisional-result contract
│   ├── controls.js           # phase-to-disabled-state projection
│   ├── draw-list-view.js     # draw ticket rendering and card effects
│   ├── draw-log.js           # log rendering and return callbacks
│   ├── wheel.js              # canonical order, geometry, rotation lifecycle
│   ├── slot.js               # reel model and continuous motion lifecycle
│   └── battle.js             # physics, canvas renderer, cancellable fight loop
├── integrations/
│   └── twitch.js             # Twitch OAuth/API/EventSub module
└── shared/
    └── presentation.js       # escaping, colors, formatting

tests/
├── unit/
│   ├── state.test.js
│   ├── random.test.js
│   ├── game-rules.test.js
│   ├── round-controller.test.js
│   ├── controls.test.js
│   ├── wheel.test.js
│   ├── slot.test.js
│   ├── battle.test.js
│   └── twitch.test.js
├── e2e/
│   ├── legacy-baseline.spec.js
│   ├── build.spec.js
│   ├── draw-controls.spec.js
│   ├── wheel.spec.js
│   ├── slot.spec.js
│   └── battle.spec.js
└── helpers/
    ├── memory-storage.js
    └── state-fixtures.js
```

---

### Task 1: Establish the Test Harness and Legacy Baseline

**Files:**
- Create: `package.json`
- Create: `package-lock.json` through npm
- Create: `.gitignore`
- Create: `vitest.config.js`
- Create: `playwright.config.js`
- Create: `tests/helpers/state-fixtures.js`
- Create: `tests/e2e/legacy-baseline.spec.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: current `index.html`, `draw.html`, and localStorage keys.
- Produces: `npm run test:unit`, `npm run test:e2e`, `npm test`, `npm run serve`, `seedDrawState(page, overrides)`, and `collectPageErrors(page)`.

If `node`/`npm` are not on PATH in Codex Desktop, call `load_workspace_dependencies` first and prepend the returned Node binary directory for the current shell. Do not hardcode that machine-specific runtime path into repository files.

- [ ] **Step 1: Add repository ignores before installing dependencies**

```gitignore
node_modules/
playwright-report/
test-results/
coverage/
.serena/
```

- [ ] **Step 2: Initialize npm and install development-only dependencies**

Run:

```powershell
npm init -y
npm install --save-dev vitest @playwright/test http-server
npx playwright install chromium
```

Expected: `package.json` and `package-lock.json` exist; Chromium installation succeeds.

- [ ] **Step 3: Define the scripts and ESM package mode**

Set the relevant `package.json` fields to:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "serve": "http-server . -p 4173 -c-1",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "test": "npm run test:unit && npm run test:e2e"
  }
}
```

- [ ] **Step 4: Configure unit and browser runners**

Create `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    coverage: { reporter: ['text', 'html'] }
  }
});
```

Create `playwright.config.js`:

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run serve',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI
  }
});
```

- [ ] **Step 5: Add deterministic browser state helpers**

Create `tests/helpers/state-fixtures.js`:

```js
export const STORAGE_KEY = 'lototron_state_v1';

export function drawState(overrides = {}) {
  return {
    games: [
      { id: 1, name: 'Alpha', copies: 1 },
      { id: 2, name: 'Beta', copies: 2 },
      { id: 3, name: 'Gamma', copies: 1 }
    ],
    nextId: 4,
    roundCount: 0,
    logEntries: [],
    visualMode: 'slot',
    instantWinMode: false,
    durationValue: 2,
    ...overrides
  };
}

export async function seedDrawState(page, overrides = {}) {
  const state = drawState(overrides);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: state });
  return state;
}

export function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}
```

- [ ] **Step 6: Write baseline tests around behavior that must survive extraction**

Create `tests/e2e/legacy-baseline.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { collectPageErrors, seedDrawState } from '../helpers/state-fixtures.js';

test('build page creates two games and unlocks draw navigation', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('Alpha');
  await page.locator('#addBtn').click();
  await page.locator('#gameInput').fill('Beta');
  await page.locator('#addBtn').click();
  await expect(page.locator('#tickets .ticket')).toHaveCount(2);
  await expect(page.locator('#lockBtn')).toBeEnabled();
});

test('draw page loads saved copies, all modes, and no runtime errors', async ({ page }) => {
  await seedDrawState(page);
  const errors = collectPageErrors(page);
  await page.goto('/draw.html');
  await expect(page.locator('#drawTickets .ticket')).toHaveCount(3);
  await expect(page.locator('#slotViewBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#wheelViewBtn').click();
  await expect(page.locator('#wheelMachine')).toBeVisible();
  await page.locator('#battleViewBtn').click();
  await expect(page.locator('#battleMachine')).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 7: Run the baseline suite before refactoring**

Run: `npm run test:e2e -- tests/e2e/legacy-baseline.spec.js`

Expected: 2 tests pass. Record any existing console noise separately; do not weaken assertions to ignore application exceptions.

- [ ] **Step 8: Document local verification commands**

Add to `README.md`:

````markdown
## Локальна розробка

```powershell
npm install
npx playwright install chromium
npm run serve
```

Відкрийте `http://127.0.0.1:4173`. Unit-тести: `npm run test:unit`;
браузерні тести: `npm run test:e2e`; повна перевірка: `npm test`.
Production build не потрібен.
````

- [ ] **Step 9: Commit the harness and passing baseline**

```powershell
git add .gitignore package.json package-lock.json vitest.config.js playwright.config.js tests README.md
git commit -m "test: add browser baseline and test harness"
```

---

### Task 2: Add Versioned State and History Storage

**Files:**
- Create: `src/core/state.js`
- Create: `tests/helpers/memory-storage.js`
- Create: `tests/unit/state.test.js`

**Interfaces:**
- Consumes: keys `lototron_state_v1` and `lototron_history_v1`; legacy version-0 state object and history array.
- Produces: `CURRENT_SCHEMA_VERSION`, `createDefaultState()`, `loadState(storage)`, `saveState(storage, state)`, `loadHistory(storage)`, `saveHistory(storage, entries)`, `addHistorySnapshot(storage, games, now)`, and result shape `{ value, error }`.

- [ ] **Step 1: Create an in-memory Storage implementation for deterministic tests**

Create `tests/helpers/memory-storage.js`:

```js
export function createMemoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    dump: () => Object.fromEntries(values)
  };
}
```

- [ ] **Step 2: Write failing migration, validation, and future-version tests**

Create `tests/unit/state.test.js` with these cases:

```js
import { describe, expect, test } from 'vitest';
import { createMemoryStorage } from '../helpers/memory-storage.js';
import {
  CURRENT_SCHEMA_VERSION, createDefaultState, loadHistory, loadState,
  saveState, STATE_KEY, HISTORY_KEY
} from '../../src/core/state.js';

test('migrates a legacy state without schemaVersion from v0 to current', () => {
  const legacy = { games: [{ id: 1, name: 'Alpha', copies: 2 }], nextId: 2 };
  const storage = createMemoryStorage({ [STATE_KEY]: JSON.stringify(legacy) });
  const { value, error } = loadState(storage);
  expect(error).toBeNull();
  expect(value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(value.games).toEqual(legacy.games);
  expect(value.visualMode).toBe('slot');
});

test('migrates the legacy history array into a versioned envelope', () => {
  const legacy = [{ id: 7, savedAt: '2026-01-01T00:00:00.000Z', games: [] }];
  const storage = createMemoryStorage({ [HISTORY_KEY]: JSON.stringify(legacy) });
  expect(loadHistory(storage).value).toEqual(legacy);
  expect(JSON.parse(storage.dump()[HISTORY_KEY])).toMatchObject({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    entries: legacy
  });
});

test('does not overwrite an unknown future state version', () => {
  const raw = JSON.stringify({ schemaVersion: 999, games: [] });
  const storage = createMemoryStorage({ [STATE_KEY]: raw });
  const result = loadState(storage);
  expect(result.value).toEqual(createDefaultState());
  expect(result.error.code).toBe('UNSUPPORTED_SCHEMA');
  expect(storage.dump()[STATE_KEY]).toBe(raw);
});

test('reports storage writes without losing the in-memory state', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const state = createDefaultState();
  expect(saveState(storage, state)).toMatchObject({ value: state, error: { code: 'STORAGE_WRITE' } });
});
```

- [ ] **Step 3: Run the tests to verify the module is missing**

Run: `npm run test:unit -- tests/unit/state.test.js`

Expected: FAIL because `src/core/state.js` does not exist.

- [ ] **Step 4: Implement explicit v0-to-v1 migration and validation**

Create `src/core/state.js` with these public constants and migration structure:

```js
export const STATE_KEY = 'lototron_state_v1';
export const HISTORY_KEY = 'lototron_history_v1';
export const CURRENT_SCHEMA_VERSION = 1;

const stateMigrations = new Map([
  [0, legacy => ({
    schemaVersion: 1,
    games: Array.isArray(legacy.games) ? legacy.games : [],
    nextId: Number.isInteger(legacy.nextId) ? legacy.nextId : 1,
    roundCount: Number.isInteger(legacy.roundCount) ? legacy.roundCount : 0,
    logEntries: Array.isArray(legacy.logEntries) ? legacy.logEntries : [],
    visualMode: ['slot', 'wheel', 'battle'].includes(legacy.visualMode) ? legacy.visualMode : 'slot',
    instantWinMode: Boolean(legacy.instantWinMode),
    durationValue: Number(legacy.durationValue) || 15
  })]
]);
```

Implement a shared `migrate(payload, migrations)` loop that rejects versions above `CURRENT_SCHEMA_VERSION`, executes every intermediate migration, and validates games as `{ id: positive integer, name: non-empty string, copies: positive integer }`. Treat malformed JSON as `INVALID_STORAGE`, return defaults, and do not throw into page code. After a successful legacy migration, persist the migrated payload. Mirror this for history using `{ schemaVersion: 1, entries }`.

- [ ] **Step 5: Run state tests and the legacy browser baseline**

Run:

```powershell
npm run test:unit -- tests/unit/state.test.js
npm run test:e2e -- tests/e2e/legacy-baseline.spec.js
```

Expected: state tests pass; 2 baseline browser tests still pass because the old pages remain untouched.

- [ ] **Step 6: Commit versioned persistence**

```powershell
git add src/core/state.js tests/helpers/memory-storage.js tests/unit/state.test.js
git commit -m "feat: add versioned state persistence"
```

---

### Task 3: Extract Deterministic Randomness and Immutable Game Rules

**Files:**
- Create: `src/core/random.js`
- Create: `src/core/game-rules.js`
- Create: `tests/unit/random.test.js`
- Create: `tests/unit/game-rules.test.js`

**Interfaces:**
- Produces from `random.js`: `shuffle(items, random)`, `shuffleNoAdjacent(items, keyFn, options, random)`, and `weightedPick(games, random)`.
- Produces from `game-rules.js`: `changeCopies(games, id, delta)`, `removeRoundCopy(games, targetId)`, `resolveInstantWinner(games, targetId)`, `returnGame(games, entry)`, and `findTerminalWinner(games)`.
- All functions return new arrays/objects and never mutate their arguments.

- [ ] **Step 1: Write failing deterministic random tests**

```js
import { expect, test } from 'vitest';
import { shuffleNoAdjacent, weightedPick } from '../../src/core/random.js';

test('weightedPick observes exact ticket boundaries', () => {
  const games = [{ id: 1, copies: 1 }, { id: 2, copies: 3 }];
  expect(weightedPick(games, () => 0).id).toBe(1);
  expect(weightedPick(games, () => 0.249999).id).toBe(1);
  expect(weightedPick(games, () => 0.25).id).toBe(2);
  expect(weightedPick(games, () => 0.999999).id).toBe(2);
});

test('shuffleNoAdjacent separates feasible duplicate keys on a circle', () => {
  const items = [{ id: 1 }, { id: 1 }, { id: 2 }, { id: 2 }];
  const result = shuffleNoAdjacent(items, item => item.id, { circular: true }, () => 0);
  result.forEach((item, index) => {
    expect(item.id).not.toBe(result[(index + 1) % result.length].id);
  });
});
```

- [ ] **Step 2: Write failing immutable game-rule tests**

```js
import { expect, test } from 'vitest';
import {
  changeCopies, findTerminalWinner, removeRoundCopy,
  resolveInstantWinner, returnGame
} from '../../src/core/game-rules.js';

const games = Object.freeze([
  Object.freeze({ id: 1, name: 'Alpha', copies: 2 }),
  Object.freeze({ id: 2, name: 'Beta', copies: 1 })
]);

test('removeRoundCopy decrements then eliminates without mutating input', () => {
  expect(removeRoundCopy(games, 1).games[0].copies).toBe(1);
  expect(games[0].copies).toBe(2);
  const lastCopies = [{ id: 1, name: 'Alpha', copies: 1 }, games[1]];
  expect(removeRoundCopy(lastCopies, 1)).toMatchObject({ eliminated: true, games: [games[1]] });
});

test('instant winner keeps only the selected game', () => {
  expect(resolveInstantWinner(games, 2).games).toEqual([games[1]]);
});

test('returned game is inserted once with one copy', () => {
  const entry = { gameId: 9, gameName: 'Returned' };
  expect(returnGame(games, entry).filter(game => game.id === 9)).toEqual([
    { id: 9, name: 'Returned', copies: 1 }
  ]);
});

test('terminal winner exists only for exactly one game', () => {
  expect(findTerminalWinner([games[0]])).toEqual(games[0]);
  expect(findTerminalWinner(games)).toBeNull();
});
```

- [ ] **Step 3: Run tests to establish red state**

Run: `npm run test:unit -- tests/unit/random.test.js tests/unit/game-rules.test.js`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement injectable randomness and immutable rule results**

Port the Fisher-Yates and no-adjacent logic from `common.js:100-171`, but make every random choice call the supplied `random` argument, defaulting to `Math.random`. Implement `weightedPick` by summing positive integer copies and throwing `RangeError` for an empty/zero-ticket pool.

Use explicit result objects from game rules:

```js
export function removeRoundCopy(games, targetId) {
  const target = games.find(game => game.id === targetId);
  if (!target) throw new RangeError(`Unknown game ${targetId}`);
  const copies = target.copies - 1;
  return {
    games: copies > 0
      ? games.map(game => game.id === targetId ? { ...game, copies } : game)
      : games.filter(game => game.id !== targetId),
    target: { ...target, copies: Math.max(0, copies) },
    eliminated: copies === 0
  };
}
```

Follow the same immutable pattern for the remaining exports.

- [ ] **Step 5: Run all unit tests and the baseline browser suite**

Run:

```powershell
npm run test:unit
npm run test:e2e -- tests/e2e/legacy-baseline.spec.js
```

Expected: all unit tests and both legacy baseline tests pass.

- [ ] **Step 6: Commit core rules**

```powershell
git add src/core/random.js src/core/game-rules.js tests/unit/random.test.js tests/unit/game-rules.test.js
git commit -m "refactor: extract random selection and game rules"
```

---

### Task 4: Implement the Round State Machine, Control Projection, and Draw Log

**Files:**
- Create: `src/draw/round-controller.js`
- Create: `src/draw/controls.js`
- Create: `src/draw/draw-log.js`
- Create: `tests/unit/round-controller.test.js`
- Create: `tests/unit/controls.test.js`

**Interfaces:**
- `RoundController` consumes `{ selectTarget, visualizationFor, commitResult, onPhaseChange, onError }`.
- `start({ mode, games, durationMs, signal? })` resolves after Slot/Battle commit or after Wheel enters `awaiting-wheel-decision`; the optional external signal has the same `AbortError` result as `cancel()`.
- `decideWheel('keep' | 'remove')` commits the provisional Wheel result.
- `cancel()` aborts active work and returns to `idle` without commit.
- `controlStateForPhase(phase)` returns booleans for `mode`, `shuffle`, `copies`, `duration`, `instant`, `start`, `back`, `logReturn`, `wheelDecision`.
- `createDrawLog(element, { onReturn })` exposes `render(entries)`, `append(entry)`, `setReturnDisabled(disabled)`, and `destroy()`.

- [ ] **Step 1: Write failing state-machine tests using fake visualizations**

```js
import { expect, test, vi } from 'vitest';
import { RoundController } from '../../src/draw/round-controller.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('Wheel play completion stays provisional until a decision', async () => {
  const commitResult = vi.fn();
  const play = vi.fn().mockResolvedValue({ kind: 'wheel-complete', targetId: 2, landedSectorIndex: 3 });
  const controller = new RoundController({
    selectTarget: () => ({ id: 2 }),
    visualizationFor: () => ({ play, cancel: vi.fn() }),
    commitResult,
    onPhaseChange: vi.fn(),
    onError: vi.fn()
  });
  await controller.start({ mode: 'wheel', games: [{ id: 2, copies: 1 }], durationMs: 2000 });
  expect(controller.phase).toBe('awaiting-wheel-decision');
  expect(commitResult).not.toHaveBeenCalled();
  await controller.decideWheel('remove');
  expect(commitResult).toHaveBeenCalledWith(expect.objectContaining({ decision: 'remove' }));
});

test.each(['external-abort', 'imperative-cancel'])('%s rejects play with AbortError and commits nothing', async path => {
  const pending = deferred();
  const commitResult = vi.fn();
  const visualization = {
    play: vi.fn(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      pending.promise.then(resolve, reject);
    })),
    cancel: vi.fn()
  };
  const controller = new RoundController({
    selectTarget: () => ({ id: 1 }), visualizationFor: () => visualization,
    commitResult, onPhaseChange: vi.fn(), onError: vi.fn()
  });
  const external = new AbortController();
  const running = controller.start({ mode: 'slot', games: [{ id: 1, copies: 1 }], durationMs: 2000, signal: external.signal });
  path === 'external-abort' ? external.abort() : controller.cancel();
  await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  expect(controller.phase).toBe('idle');
  expect(commitResult).not.toHaveBeenCalled();
});

test('a visualization error returns to idle and commits nothing', async () => {
  const commitResult = vi.fn();
  const onError = vi.fn();
  const controller = new RoundController({
    selectTarget: () => ({ id: 1 }),
    visualizationFor: () => ({ play: () => Promise.reject(new Error('render failed')), cancel: vi.fn() }),
    commitResult, onPhaseChange: vi.fn(), onError
  });
  await expect(controller.start({ mode: 'slot', games: [{ id: 1, copies: 1 }], durationMs: 2000 })).rejects.toThrow('render failed');
  expect(controller.phase).toBe('idle');
  expect(commitResult).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Write failing control-lock tests for every active phase**

```js
import { expect, test } from 'vitest';
import { controlStateForPhase } from '../../src/draw/controls.js';

test.each(['animating', 'awaiting-wheel-decision', 'resolving'])(
  '%s disables every conflicting control', phase => {
    const state = controlStateForPhase(phase);
    expect(state).toMatchObject({
      mode: true, shuffle: true, copies: true, duration: true,
      instant: true, start: true, back: true, logReturn: true
    });
  }
);

test('only Wheel decisions remain enabled while awaiting a decision', () => {
  expect(controlStateForPhase('awaiting-wheel-decision').wheelDecision).toBe(false);
  expect(controlStateForPhase('animating').wheelDecision).toBe(true);
});
```

Here `true` means the native control's `disabled` property is true.

- [ ] **Step 3: Run focused tests to verify red state**

Run: `npm run test:unit -- tests/unit/round-controller.test.js tests/unit/controls.test.js`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the formal transition table and shared abort behavior**

Use this transition table in `round-controller.js`:

```js
const transitions = {
  idle: new Set(['animating']),
  animating: new Set(['awaiting-wheel-decision', 'resolving', 'idle']),
  'awaiting-wheel-decision': new Set(['resolving', 'idle']),
  resolving: new Set(['idle', 'finished']),
  finished: new Set(['idle'])
};
```

`start()` creates an internal `AbortController`, mirrors an optional external signal into it, and passes only the internal signal to `visualization.play()`. `cancel()` must call both `internal.abort()` and the visualization's idempotent `cancel()`. Normalize both cancellation paths by rethrowing `new DOMException('Aborted', 'AbortError')`, clearing provisional state, and transitioning to `idle`. Only non-Abort errors call `onError(error)`; they also transition to `idle` without commit.

- [ ] **Step 5: Implement native control projection**

Export `applyControlState(elements, state)` from `controls.js`. It assigns `.disabled` to the three mode buttons, shuffle, copy steppers, duration, instant, start, Back button, return buttons, and Wheel decision buttons. Do not emulate disabled anchors; `#backBtn` remains a button.

- [ ] **Step 6: Implement the log view with listener ownership**

Port formatting behavior from `draw.js:637-713`. Attach return handlers with event delegation on the list rather than one listener per render, escape user-controlled names before assigning markup, and make `destroy()` remove the delegated listener. `append()` calls `li.scrollIntoView({ block: 'nearest' })`; do not scroll the entire document.

- [ ] **Step 7: Run the focused and complete unit suites**

Run:

```powershell
npm run test:unit -- tests/unit/round-controller.test.js tests/unit/controls.test.js
npm run test:unit
```

Expected: all tests pass with no unhandled promise rejections.

- [ ] **Step 8: Commit the coordinator primitives**

```powershell
git add src/draw/round-controller.js src/draw/controls.js src/draw/draw-log.js tests/unit/round-controller.test.js tests/unit/controls.test.js
git commit -m "refactor: add round lifecycle and control locking"
```

---

### Task 5: Build the Canonical-Order Wheel Visualization

**Files:**
- Create: `src/draw/wheel.js`
- Create: `tests/unit/wheel.test.js`
- Create: `tests/e2e/wheel.spec.js`

**Interfaces:**
- `createWheelVisualization(elements, { random, prefersReducedMotion, makeEntryId })` returns `initialize(games)`, `render(model)`, `play({ target, durationMs, signal })`, idempotent `cancel()`, `destroy()`, `reconcile(games, change)`, and `shuffle()`.
- `render(model)` consumes `{ games }` and never changes order by itself.
- `play()` returns `{ kind: 'wheel-complete', targetId, landedSectorIndex }`.
- Pure exports: `createInitialWheelOrder(games, makeEntryId, random)`, `reconcileWheelOrder(order, games, change, makeEntryId)`, `selectTargetSector(order, targetId, random)`, and `computeTargetRotation(input)`.
- Canonical entries have `{ entryId, gameId }`; `entryId` is session-local and stable across reconciliation.

- [ ] **Step 1: Write failing canonical-order unit tests**

```js
import { expect, test } from 'vitest';
import { reconcileWheelOrder } from '../../src/draw/wheel.js';

const order = [
  { entryId: 'a1', gameId: 1 },
  { entryId: 'b1', gameId: 2 },
  { entryId: 'a2', gameId: 1 },
  { entryId: 'c1', gameId: 3 }
];

function retainedIds(before, after) {
  const afterIds = new Set(after.map(entry => entry.entryId));
  return before.map(entry => entry.entryId).filter(id => afterIds.has(id));
}

test('copy increase inserts one entry while preserving all existing relative order', () => {
  const games = [{ id: 1, copies: 3 }, { id: 2, copies: 1 }, { id: 3, copies: 1 }];
  const next = reconcileWheelOrder(order, games, { type: 'increase', gameId: 1 }, () => 'a3');
  expect(retainedIds(order, next)).toEqual(order.map(entry => entry.entryId));
  expect(next.filter(entry => entry.gameId === 1)).toHaveLength(3);
});

test('landed removal removes exactly that index and preserves every other entry', () => {
  const games = [{ id: 1, copies: 1 }, { id: 2, copies: 1 }, { id: 3, copies: 1 }];
  const next = reconcileWheelOrder(order, games, { type: 'landed-remove', index: 2 }, () => 'unused');
  expect(next.map(entry => entry.entryId)).toEqual(['a1', 'b1', 'c1']);
});

test('game removal and ordinary copy decrease preserve remaining relative order', () => {
  const removeGame = reconcileWheelOrder(order, [{ id: 1, copies: 2 }, { id: 3, copies: 1 }], { type: 'remove-game', gameId: 2 });
  expect(removeGame.map(entry => entry.entryId)).toEqual(['a1', 'a2', 'c1']);
  const decrease = reconcileWheelOrder(order, [{ id: 1, copies: 1 }, { id: 2, copies: 1 }, { id: 3, copies: 1 }], { type: 'decrease', gameId: 1 });
  expect(decrease.map(entry => entry.entryId)).toEqual(['a1', 'b1', 'c1']);
});
```

Also test `createInitialWheelOrder`: it creates exactly one stable entry per copy and uses the no-adjacent circular layout whenever the copy distribution makes that possible. `initialize(games)` may call this function once when canonical order is empty; subsequent `render()` and `play()` calls must not call it again.

- [ ] **Step 2: Write failing rotation and cancellation unit tests**

Test that `computeTargetRotation` starts strictly from `currentRotation`, adds full clockwise turns, and ends inside the selected sector edge margin. Test both an externally aborted signal and `cancel()` against a fake animation object; both `play()` promises must reject with `name === 'AbortError'`. Call `cancel()` twice and assert the fake animation's `cancel` method is called once. After `destroy()`, assert `render()` and `play()` fail with `code === 'VISUALIZATION_DESTROYED'`. With `prefersReducedMotion: true`, assert the planned duration is at most 120 ms and no full turn is added.

- [ ] **Step 3: Run Wheel unit tests to verify red state**

Run: `npm run test:unit -- tests/unit/wheel.test.js`

Expected: FAIL because `src/draw/wheel.js` is missing.

- [ ] **Step 4: Implement exact canonical reconciliation**

Implement `reconcileWheelOrder` in this order:

1. Validate a landed index before removal.
2. Remove all entries for missing games.
3. Remove surplus copies from the end for ordinary decreases.
4. Insert missing copies one at a time. Scan circular insertion gaps from index 0 and use the first gap whose two neighbor `gameId` values differ from the inserted game. If none exists, compute clockwise distance as the count of intervening canonical entries between consecutive matching entries; insert after the matching entry with the largest count, lowest index on ties.
5. Assert final per-game counts equal `games[].copies`.

Never call shuffle from reconciliation. The public `shuffle()` method is the only full Fisher-Yates reorder operation.

- [ ] **Step 5: Implement one-element cumulative rotation**

Render the SVG structure from `draw.js:225-257`, but keep it mounted between idle and active motion. Apply all rotation to `#wheelSvg`; remove `.wheel-stage.idle-spin`. Use a long-running linear Web Animation for idle motion, read its computed matrix when a round starts, commit that angle to `currentRotation`, cancel idle, and animate from that exact value to `computeTargetRotation(...)`. Preserve the SVG and label order at round start.

The `play()` implementation must:

```js
async function play({ target, durationMs, signal }) {
  throwIfDestroyed();
  const landedSectorIndex = selectTargetSector(order, target.id, random);
  const start = stopIdleAtCurrentAngle();
  const end = computeTargetRotation({ start, landedSectorIndex, sectorCount: order.length, durationMs, random });
  await animateRotation({ start, end, durationMs, signal });
  currentRotation = end;
  return { kind: 'wheel-complete', targetId: target.id, landedSectorIndex };
}
```

Reduced motion uses at most 120 ms, adds no full turns, and still lands inside the selected sector.

- [ ] **Step 6: Add browser regressions for order and angle continuity**

Create `tests/e2e/wheel.spec.js` that seeds Wheel mode, captures label text and the computed rotation matrix, clicks Start, and asserts:

```js
const labelsBefore = await page.locator('#wheelSvg .wheel-label').allTextContents();
const matrixBefore = await page.locator('#wheelSvg').evaluate(el => getComputedStyle(el).transform);
await page.locator('#startRoundBtn').click();
await expect(page.locator('#wheelSvg .wheel-label')).toHaveText(labelsBefore);
const matrixAfterStart = await page.locator('#wheelSvg').evaluate(el => getComputedStyle(el).transform);
expect(matrixAfterStart).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
expect(matrixBefore).not.toBe('none');
```

Also decide Remove and assert the post-removal labels equal the pre-removal sequence with exactly the landed occurrence removed; decide Keep in a second test and assert copies and label order remain unchanged.

Add a reduced-motion case with `await page.emulateMedia({ reducedMotion: 'reduce' })`; Start must show the decision popup within 500 ms and land on the selected target without full-spin timing assumptions.

- [ ] **Step 7: Run Wheel unit tests**

Run: `npm run test:unit -- tests/unit/wheel.test.js`

Expected: all Wheel unit tests pass. The new E2E tests remain excluded until `draw-page.js` integrates the module in Task 8.

- [ ] **Step 8: Commit Wheel module and regressions**

```powershell
git add src/draw/wheel.js tests/unit/wheel.test.js tests/e2e/wheel.spec.js
git commit -m "feat: add stable canonical wheel visualization"
```

---

### Task 6: Build the Continuous-Velocity Slot Visualization

**Files:**
- Create: `src/draw/slot.js`
- Create: `tests/unit/slot.test.js`
- Create: `tests/e2e/slot.spec.js`

**Interfaces:**
- `createSlotVisualization(elements, { random, prefersReducedMotion })` returns the standard visualization lifecycle.
- `play()` returns `{ kind: 'slot-complete', targetId }`.
- Pure exports: `buildReelModel(input)`, `velocityAt(progress, profile)`, and `createMotionKeyframes(input)`.
- `createMotionKeyframes` returns `{ keyframes, finalTranslateY, targetIndex }`.

- [ ] **Step 1: Write failing reel and target-placement tests**

```js
import { expect, test } from 'vitest';
import { buildReelModel } from '../../src/draw/slot.js';

test('buildReelModel centers the selected target with enough trailing rows', () => {
  const games = [{ id: 1, copies: 1 }, { id: 2, copies: 1 }, { id: 3, copies: 1 }];
  const model = buildReelModel({ games, targetId: 2, visibleRows: 5, durationMs: 2000, random: () => 0 });
  expect(model.items[model.targetIndex].id).toBe(2);
  expect(model.items.length - model.targetIndex - 1).toBeGreaterThanOrEqual(2);
});

test('target insertion avoids an adjacent duplicate when a valid arrangement exists', () => {
  const games = [{ id: 1, copies: 2 }, { id: 2, copies: 2 }, { id: 3, copies: 1 }];
  const model = buildReelModel({ games, targetId: 1, visibleRows: 3, durationMs: 2000, random: () => 0 });
  expect(model.items[model.targetIndex - 1].id).not.toBe(1);
  expect(model.items[model.targetIndex + 1].id).not.toBe(1);
});
```

- [ ] **Step 2: Write failing velocity-continuity tests**

Use a profile `{ acceleration: 0.12, deceleration: 0.25 }`. Sample `velocityAt` immediately before and after both boundaries with epsilon `1e-6`; differences must be below `1e-4`. Sample 100 points from deceleration start to 1 and assert each velocity is less than or equal to the preceding velocity and the final velocity is zero. Assert the last keyframe transform equals `finalTranslateY` exactly. Verify `cancel()` and external abort both reject with `AbortError`, repeated `cancel()` cancels one Animation once, reduced motion completes within 120 ms, and `destroy()` rejects later `render()`/`play()` calls with `VISUALIZATION_DESTROYED`.

- [ ] **Step 3: Run Slot unit tests to verify red state**

Run: `npm run test:unit -- tests/unit/slot.test.js`

Expected: FAIL because `src/draw/slot.js` is missing.

- [ ] **Step 4: Implement an analytic continuous velocity profile**

Use smoothstep `s(x) = x * x * (3 - 2 * x)`:

```js
export function velocityAt(progress, { acceleration = 0.12, deceleration = 0.25 } = {}) {
  if (progress <= 0) return 0;
  if (progress < acceleration) return smoothstep(progress / acceleration);
  const decelStart = 1 - deceleration;
  if (progress <= decelStart) return 1;
  if (progress < 1) return 1 - smoothstep((progress - decelStart) / deceleration);
  return 0;
}
```

Numerically integrate this velocity over fixed normalized samples, normalize cumulative distance so the final sample is exactly 1, and output linear-interpolated keyframes. Distance is based on configured travel speed times duration, rounded up to complete 56 px rows, with enough trailing rows to center the target. This makes velocity continuous at both boundaries and monotonically decreasing in the stopping phase.

- [ ] **Step 5: Implement cancellable WAAPI playback**

Port metric calculation and item rendering from `draw.js:55-86` and `draw.js:731-835`. Own one active `Animation`. External abort and `cancel()` both cancel it and reject the pending `play()` with `AbortError`; `cancel()` is idempotent. On finish, first set `slotStrip.style.transform` to `finalTranslateY`, then cancel/release the Animation, then add the landed highlight. Reduced motion renders the final reel and lands within 120 ms without high-speed scrolling.

- [ ] **Step 6: Add a browser landing/no-jump test**

Create `tests/e2e/slot.spec.js`. Seed two-second Slot mode, start a round, wait for `.slot-landed`, read the strip transform, wait 150 ms, and assert the transform is unchanged. Assert exactly one `.slot-item-center` exists and its text matches the logged target. Do not assert frame-to-frame speed in Playwright.

Add a reduced-motion case using `page.emulateMedia({ reducedMotion: 'reduce' })`; `.slot-landed` must appear within 500 ms with the correct selected target.

- [ ] **Step 7: Run Slot and complete unit suites**

Do not change live Slot CSS while `draw.html` still loads legacy `draw.js`; perform the CSS ownership cutover atomically in Task 8. Run:

```powershell
npm run test:unit -- tests/unit/slot.test.js
npm run test:unit
```

Expected: all Slot and existing unit tests pass.

- [ ] **Step 8: Commit Slot module and tests**

```powershell
git add src/draw/slot.js tests/unit/slot.test.js tests/e2e/slot.spec.js
git commit -m "feat: add continuous slot visualization"
```

---

### Task 7: Extract Battle Royale into One Cancellable Lifecycle

**Files:**
- Create: `src/draw/battle.js`
- Create: `tests/unit/battle.test.js`
- Create: `tests/e2e/battle.spec.js`

**Interfaces:**
- `createBattleVisualization(elements, { random, requestFrame, cancelFrame, now, battleConfig })` returns the standard lifecycle. Production defaults are `{ hpOverride: null, hitCooldownMs: 350, damageMin: 6, damageMax: 14 }`.
- `play()` returns `{ kind: 'battle-complete', eliminatedIds, survivorId }`.
- Pure exports: `ballHp(game)`, `ballRadius(hp)`, `createBalls(input)`, and `stepPhysics(state, dt, options)`.
- Battle reports IDs only; it never edits cards, games, logs, or localStorage.

- [ ] **Step 1: Write failing pure physics tests**

```js
import { expect, test } from 'vitest';
import { ballHp, stepPhysics } from '../../src/draw/battle.js';

test('copies add five HP after the first copy', () => {
  expect(ballHp({ copies: 1 })).toBe(100);
  expect(ballHp({ copies: 4 })).toBe(115);
});

test('stepPhysics clamps dt and keeps balls inside arena bounds', () => {
  const state = {
    width: 200, height: 100,
    balls: [{ gameId: 1, r: 10, x: 195, y: 50, vx: 100, vy: 0, hp: 100, maxHp: 100 }]
  };
  const next = stepPhysics(state, 2, { dealDamage: false, random: () => 0 });
  expect(next.dt).toBe(0.05);
  expect(next.balls[0].x).toBeLessThanOrEqual(190);
});
```

- [ ] **Step 2: Write failing lifecycle-result and cancellation tests**

Inject fake `requestFrame`/`cancelFrame` functions. Start `play()`, advance frames until one survivor remains, and assert the discriminated result includes ordered unique `eliminatedIds` and `survivorId`. In separate cases abort the external signal and call `cancel()` twice; both pending plays reject with `AbortError`, and only one frame ID is cancelled. After `destroy()`, assert later `render()`/`play()` calls fail with `VISUALIZATION_DESTROYED`.

- [ ] **Step 3: Run Battle unit tests to verify red state**

Run: `npm run test:unit -- tests/unit/battle.test.js`

Expected: FAIL because `src/draw/battle.js` is missing.

- [ ] **Step 4: Port physics and rendering without application mutations**

Move the algorithms from `draw.js:277-478` into pure helpers plus the visualization closure. Keep the 50 ms dt cap. Read cooldown and damage bounds from the validated `battleConfig`, using the production defaults from the interface; `hpOverride` replaces calculated HP only when it is a positive finite test value. Replace `eliminateBattleBall()` with accumulation into an `eliminatedIds` array. Resolve `play()` only when one ball remains; do not call draw-page rendering or persistence from the loop.

- [ ] **Step 5: Implement idle, play, cancel, and destroy with one RAF owner**

Maintain exactly one `frameId` and one pending play resolver. `render(model)` sizes the canvas and initializes idle balls. `play()` stops idle before starting fight frames. `cancel()` clears the frame, cooldown map, and pending listeners idempotently. `destroy()` also releases the canvas/context references and rejects later operations.

- [ ] **Step 6: Add Battle browser coverage**

Create `tests/e2e/battle.spec.js`. Before navigation, install this deterministic local-only configuration:

```js
await page.addInitScript(() => {
  window.__GAME_WHEEL_TEST__ = {
    battle: { hpOverride: 1, hitCooldownMs: 0, damageMin: 1, damageMax: 1 }
  };
});
```

`draw-page.js` may pass this object as `battleConfig` only when `location.hostname` is `127.0.0.1` or `localhost`; on every other host it must pass the production defaults regardless of the global. Assert mode controls are disabled during combat, eliminations are committed only after the visualization result, the final winner banner appears, and `pagehide` produces no further canvas frames or page errors.

- [ ] **Step 7: Run Battle and complete unit suites**

Run:

```powershell
npm run test:unit -- tests/unit/battle.test.js
npm run test:unit
```

Expected: all tests pass.

- [ ] **Step 8: Commit Battle module and tests**

```powershell
git add src/draw/battle.js tests/unit/battle.test.js tests/e2e/battle.spec.js
git commit -m "refactor: isolate battle visualization lifecycle"
```

---

### Task 8: Integrate the Modular Draw Page and Remove `draw.js`

**Files:**
- Create: `src/shared/presentation.js`
- Create: `src/draw/draw-list-view.js`
- Create: `src/draw/draw-page.js`
- Create: `tests/e2e/draw-controls.spec.js`
- Modify: `draw.html:122-124`
- Modify: `styles.css:341-558`
- Modify: `tests/e2e/wheel.spec.js`
- Modify: `tests/e2e/slot.spec.js`
- Modify: `tests/e2e/battle.spec.js`
- Delete: `draw.js`

**Interfaces:**
- `draw-page.js` imports all core modules, views, `RoundController`, and visualization factories.
- `createDrawListView(element, handlers)` exposes `render(games, options)`, `setDisabled(disabled)`, `markWinner(id)`, `markEliminated(id)`, and `destroy()`.
- `presentation.js` exports `escapeHtml`, `normalizeName`, `colorForGame`, `hexToRgba`, and `formatSavedAt` migrated from `common.js`.

- [ ] **Step 1: Write failing browser tests for native locking and commit timing**

Create `tests/e2e/draw-controls.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { seedDrawState } from '../helpers/state-fixtures.js';

test('all conflicting controls are natively disabled for an active round', async ({ page }) => {
  await seedDrawState(page, { visualMode: 'slot', durationValue: 2 });
  await page.goto('/draw.html');
  await page.locator('#startRoundBtn').click();
  for (const selector of [
    '#slotViewBtn', '#wheelViewBtn', '#battleViewBtn', '#shuffleVisualsBtn',
    '#durationRange', '#instantWinToggle', '#startRoundBtn', '#backBtn'
  ]) {
    await expect(page.locator(selector)).toBeDisabled();
  }
  await expect(page.locator('#drawTickets .step-btn').first()).toBeDisabled();
});

test('Wheel play completion does not commit until Keep or Remove', async ({ page }) => {
  await seedDrawState(page, { visualMode: 'wheel', durationValue: 2 });
  await page.goto('/draw.html');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  await page.locator('#startRoundBtn').click();
  await expect(page.locator('#wheelResultPopup')).toHaveClass(/show/);
  const provisional = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  expect(provisional.roundCount).toBe(before.roundCount);
  expect(provisional.games).toEqual(before.games);
  await page.locator('#wheelKeepBtn').click();
  const committed = await page.evaluate(() => JSON.parse(localStorage.getItem('lototron_state_v1')));
  expect(committed.roundCount).toBe(before.roundCount + 1);
});
```

- [ ] **Step 2: Run the new draw tests against legacy code to prove regressions**

Run: `npm run test:e2e -- tests/e2e/draw-controls.spec.js tests/e2e/wheel.spec.js tests/e2e/slot.spec.js`

Expected: FAIL because legacy controls remain visually enabled and Wheel reshuffles/resets. The provisional-storage assertion may already pass and remains as a compatibility guard.

- [ ] **Step 3: Move shared presentation helpers out of `common.js`**

Port `common.js:69-98` into `src/shared/presentation.js` as named exports. Keep palette indexing stable so existing game colors do not change.

- [ ] **Step 4: Implement draw-list rendering with delegated events**

Port card rendering from `draw.js:123-202` into `draw-list-view.js`. Use one click listener on `#drawTickets` and dispatch semantic handlers `{ onCopyDelta(id, delta) }`. `setDisabled(true)` sets native `.disabled` on every stepper. Preserve class names and markup so CSS remains unchanged.

- [ ] **Step 5: Assemble the draw-page coordinator**

In `draw-page.js`:

1. Load `{ value: state, error }` from `state.js`; redirect to `index.html` only when validated games are empty.
2. Create list/log views and all three visualizations once; call `wheel.initialize(state.games)` exactly once before its first render.
3. Create `RoundController` with `weightedPick`, mode lookup, phase rendering, and one `commitResult` callback.
4. Keep target/result provisional until the controller requests commit.
5. For Slot Remove, call `removeRoundCopy`; for instant mode, call `resolveInstantWinner`.
6. For Wheel Keep, increment `roundCount` and append the keep log without copy changes. For Wheel Remove, use `landedSectorIndex`, reconcile Wheel order minimally, then apply the relevant game rule.
7. For Battle, apply `eliminatedIds` in reported order, incrementing `roundCount` and appending the existing elimination log for each ID, then retain `survivorId` and append the final winner log.
8. Persist once per committed transition; show nonfatal storage errors in `#statusLine`.
9. On `pagehide`, call controller `cancel()` and every visualization/view `destroy()`.
10. Route every composition change through Wheel reconciliation: copy steppers use `increase`/`decrease`, return-to-pool uses `increase`, landed Remove uses `landed-remove`, and full eliminations use `remove-game`. Preserve existing entries' relative order in each case.
11. Route `#shuffleVisualsBtn` to `wheel.shuffle()` only for Wheel mode; this explicit action is the only full canonical reorder. Slot rebuilds its idle reel and Battle rebuilds idle balls without changing game state.

Use one phase callback:

```js
function renderPhase(phase) {
  const disabled = controlStateForPhase(phase);
  applyControlState(elements, disabled);
  drawList.setDisabled(disabled.copies);
  drawLog.setReturnDisabled(disabled.logReturn);
  wheelResultPopup.classList.toggle('show', phase === 'awaiting-wheel-decision');
}
```

- [ ] **Step 6: Replace draw scripts with the module entry point**

Replace `draw.html:122-124` with:

```html
<script type="module" src="src/draw/draw-page.js"></script>
```

At the same cutover, remove `@keyframes wheelIdleSpin` and `.wheel-stage.idle-spin` from `styles.css:524-534`, because `wheel.js` owns idle rotation. Keep Slot layout/glow rules but remove any `.slot-strip` transform transition that competes with `slot.js` WAAPI ownership. Delete `draw.js` only after the module entry loads with no runtime errors.

- [ ] **Step 7: Run the complete draw browser suite**

Run:

```powershell
npm run test:e2e -- tests/e2e/legacy-baseline.spec.js tests/e2e/draw-controls.spec.js tests/e2e/wheel.spec.js tests/e2e/slot.spec.js tests/e2e/battle.spec.js
```

Expected: all draw tests pass. Keep every assertion in `legacy-baseline.spec.js`; its filename does not affect production behavior.

- [ ] **Step 8: Run all unit and browser tests**

Run: `npm test`

Expected: all tests pass; neither `draw.html` nor its imports reference `draw.js` or `window.Common`.

- [ ] **Step 9: Commit the draw-page cutover**

```powershell
git add src draw.html styles.css tests
git rm draw.js
git commit -m "refactor: migrate draw page to tested modules"
```

---

### Task 9: Migrate the Build Page and Twitch Integration

**Files:**
- Create: `src/build/game-list-view.js`
- Create: `src/build/build-page.js`
- Create: `src/integrations/twitch.js`
- Create: `tests/unit/twitch.test.js`
- Create: `tests/e2e/build.spec.js`
- Modify: `index.html:53-77,109-112`
- Delete: `build.js`
- Delete: `twitch.js`
- Delete: `common.js`

**Interfaces:**
- `createGameListView(elements, handlers)` owns build-list/history DOM and exposes `render(state, history)`, `destroy()`.
- `createTwitchIntegration(elements, { onGameRedeemed, fetch, WebSocketClass, location, history, storage })` exposes `init()`, `login()`, `logout()`, and `destroy()`.
- `build-page.js` is the only build-page owner of game state and passes `addGame(name, copies, addedBy)` to both manual UI and Twitch.

- [ ] **Step 1: Write failing build/history browser tests**

Create `tests/e2e/build.spec.js` covering:

```js
test('duplicate normalized names add copies instead of cards', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#gameInput').fill('  Alpha   Game ');
  await page.locator('#copiesInput').fill('2');
  await page.locator('#addBtn').click();
  await page.locator('#gameInput').fill('alpha game');
  await page.locator('#copiesInput').fill('3');
  await page.locator('#addBtn').click();
  await expect(page.locator('#tickets .ticket')).toHaveCount(1);
  await expect(page.locator('#tickets .copies-badge')).toHaveText('× 5');
});
```

Also test clearing archives the current list, loading history assigns fresh IDs, reset restores schema-versioned defaults, and a reload preserves the build state.

- [ ] **Step 2: Run build tests against current behavior**

Run: `npm run test:e2e -- tests/e2e/build.spec.js`

Expected: existing behavior tests pass where already supported; schema-envelope assertions fail until the module migration.

- [ ] **Step 3: Implement the build list/history view**

Port markup from `build.js:67-138`. Use delegated click handling based on `data-action="remove|decrease|increase|load-history"` and `data-id`. Escape game/history names with `escapeHtml`; preserve existing CSS classes and confirmation text.

- [ ] **Step 4: Implement the build coordinator using versioned state**

Port behavior from `build.js:20-65` and `build.js:140-203`. Normalize names with `normalizeName`, use immutable `changeCopies`, and save after each accepted change. `addGame` is the single entry for manual and Twitch additions. Add `<div id="storageStatus" role="status" hidden></div>` to the bottom of the input HUD panel; unhide it with a concise message on `STORAGE_WRITE` and hide it after the next successful save.

- [ ] **Step 5: Convert Twitch into an injected, teardown-safe module**

Port OAuth/API/EventSub behavior from `twitch.js`, preserving Client ID, scopes, reward title, prompt, token key, and visible copy. Replace `window.BuildPage.addExternalGame` with injected `onGameRedeemed(name, userName)`. `destroy()` closes the current WebSocket and clears the reconnect timer. Reject or display API errors without changing build-page state. Preserve token URL cleanup with `history.replaceState`.

First write `tests/unit/twitch.test.js` with injected fake `fetch`, WebSocket, timers, location, history, and storage. Verify: invalid validation clears the token; an API error updates reward status without calling `onGameRedeemed`; a matching redemption calls `onGameRedeemed(name, userName)` once; `destroy()` closes the socket and clears exactly one reconnect timer. Run `npm run test:unit -- tests/unit/twitch.test.js` before implementation and expect module/import failure, then implement until it passes.

- [ ] **Step 6: Switch `index.html` to the module entry point and remove globals**

Replace `index.html:109-112` with:

```html
<script type="module" src="src/build/build-page.js"></script>
```

Delete `build.js`, `twitch.js`, and `common.js` after both HTML pages import only `src/` modules.

- [ ] **Step 7: Run build, draw, and persistence suites**

Run:

```powershell
npm run test:unit
npm run test:e2e -- tests/e2e/build.spec.js tests/e2e/legacy-baseline.spec.js tests/e2e/draw-controls.spec.js tests/e2e/wheel.spec.js tests/e2e/slot.spec.js tests/e2e/battle.spec.js
```

Expected: all tests pass; both entry pages load with no page errors; legacy storage is migrated in place.

- [ ] **Step 8: Commit the build/Twitch cutover**

```powershell
git add src index.html tests
git rm build.js twitch.js common.js
git commit -m "refactor: migrate build and Twitch flows to modules"
```

---

### Task 10: Add CI, Remove Dead Code, and Verify Static Deployment

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `README.md`
- Delete: `app.js`
- Verify: `index.html`
- Verify: `draw.html`
- Verify: `home.css`
- Verify: `styles.css`

**Interfaces:**
- Consumes: npm scripts from Task 1 and all test suites.
- Produces: CI gate on pushes/PRs and a source-only GitHub Pages-compatible tree.

- [ ] **Step 1: Add GitHub Actions verification**

Create `.github/workflows/test.yml`:

```yaml
name: test

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:unit
      - run: npm run test:e2e
```

- [ ] **Step 2: Remove the dead monolith and scan for stale references**

Run:

```powershell
git rm app.js
rg -n "app\.js|draw\.js|build\.js|common\.js|twitch\.js|window\.Common|window\.BuildPage" -g "*.html" -g "*.js" -g "*.md"
```

Expected: no production reference remains. Documentation may mention removed files only in an explicit migration note; otherwise update it.

- [ ] **Step 3: Update README structure and deployment documentation**

Document the `src/core`, `src/build`, `src/draw`, `src/integrations`, `tests/unit`, and `tests/e2e` responsibilities. State explicitly that GitHub Pages deploys repository files directly and that npm is development-only.

- [ ] **Step 4: Run syntax, test, and static-server verification**

Run:

```powershell
npm test
node --check src/core/state.js
node --check src/core/random.js
node --check src/core/game-rules.js
node --check src/build/build-page.js
node --check src/draw/draw-page.js
node --check src/integrations/twitch.js
```

Expected: all unit and browser tests pass; every syntax check exits 0.

- [ ] **Step 5: Verify production entry points and module responses in Chromium**

Extend the second test in `tests/e2e/legacy-baseline.spec.js` to collect failed responses:

```js
const failedResponses = [];
page.on('response', response => {
  if (response.status() >= 400) failedResponses.push([response.status(), response.url()]);
});
// After both entry-point navigations:
expect(failedResponses).toEqual([]);
expect(await page.locator('script[type="module"]').count()).toBe(1);
```

Run: `npm run test:e2e -- tests/e2e/legacy-baseline.spec.js`

Expected: both entry points load over `http://127.0.0.1:4173`, every requested module returns below HTTP 400, no page error occurs, and neither page requests a generated bundle.

- [ ] **Step 6: Verify acceptance criteria explicitly**

Run the focused commands and record their pass counts in the commit/PR notes:

```powershell
npm run test:unit -- tests/unit/wheel.test.js tests/unit/slot.test.js tests/unit/round-controller.test.js
npm run test:e2e -- tests/e2e/draw-controls.spec.js tests/e2e/wheel.spec.js tests/e2e/slot.spec.js tests/e2e/battle.spec.js
git status --short
```

Expected: canonical relative order, cancellation equivalence, Wheel commit timing, control locking, Slot landing, Battle teardown, and final winners all pass. `git status` contains only intended changes; `.serena/` is ignored.

- [ ] **Step 7: Commit final cleanup and CI**

```powershell
git add .github README.md .gitignore package.json package-lock.json src tests index.html draw.html home.css styles.css
git add -u
git commit -m "ci: verify modular static application"
```

- [ ] **Step 8: Run final verification from the committed tree**

Run:

```powershell
npm test
git status --short
git log -10 --oneline
```

Expected: all tests pass, the working tree is clean, and the task commits appear in the intended sequence.
