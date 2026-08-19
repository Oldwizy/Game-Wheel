# Modular Refactor Design

## Goal

Refactor Game Wheel into focused, testable JavaScript modules while preserving the current appearance, user-facing features, draw rules, and GitHub Pages deployment. Fix the confirmed wheel reshuffle and discontinuous scrolling animations as part of the refactor.

## Constraints

- Keep the existing `index.html` and `draw.html` user flows and visual design.
- Keep the application framework-free and backend-free.
- Publish directly as static HTML, CSS, and JavaScript at `https://oldwizy.github.io/Game-Wheel/`.
- Require no production build step. GitHub Pages serves the source modules directly.
- Development tooling may use Node.js, Vitest, Playwright, and GitHub Actions.
- Target current evergreen browsers that support native ES modules and the Web Animations API.
- Preserve the current localStorage keys. Version stored payloads explicitly and migrate malformed or older saved values through a tested sequential migration pipeline.
- Preserve weighted selection semantics: each copy contributes one ticket.
- Preserve the Slot, Wheel, Battle Royale, instant-winner, history, return-to-pool, and Twitch flows.

Direct `file://` execution is not a compatibility requirement. Local development uses a static HTTP server so native ES module loading matches GitHub Pages.

## Confirmed Problems

### Wheel reshuffle

`spinWheel()` currently rebuilds and shuffles `wheelEntries` at every round start. This contradicts the existing attempt to preserve sector order after a result and causes the visible wheel contents to change immediately before spinning.

### Wheel transform discontinuities

Idle rotation is applied to `.wheel-stage`, while the round rotation is applied independently to `#wheelSvg`. Removing the idle class resets the outer transform to zero. `spinWheel()` then recreates the SVG and resets its transform to zero, producing visible jumps before the round animation.

### Slot velocity discontinuity

The slot animation divides motion into a linear phase followed by `cubic-bezier(0.11, 0.42, 0.2, 1)`. The second segment begins at roughly 3.8 times the preceding velocity, so the supposed deceleration phase visibly accelerates before slowing down. Browser measurements at a two-second duration showed an increase from roughly 500 px/s to roughly 1,800 px/s at the phase boundary.

### Coupled responsibilities

`draw.js` owns persistence, business rules, DOM construction, random selection, three animation systems, canvas physics, logs, controls, and lifecycle state. The visualizations mutate shared state indirectly, making animation behavior difficult to test and cancellation unsafe.

### Dead implementation

`app.js` is an obsolete monolithic implementation not loaded by either HTML page. Keeping it creates ambiguity about which implementation is active.

## Architecture

Production code will use native ES modules:

```text
src/
├── core/
│   ├── state.js
│   ├── random.js
│   └── game-rules.js
├── build/
│   ├── build-page.js
│   └── game-list-view.js
├── draw/
│   ├── draw-page.js
│   ├── controls.js
│   ├── slot.js
│   ├── wheel.js
│   ├── battle.js
│   └── draw-log.js
└── integrations/
    └── twitch.js
```

### `core/state.js`

Owns default state, validation, localStorage reads and writes, history storage, and compatibility with the existing storage keys. It exposes explicit load/save operations and never accesses page DOM.

New state payloads include `schemaVersion`. A payload without that field is version 0. `state.js` defines `CURRENT_SCHEMA_VERSION` plus a migration registry in which migration `N` accepts version `N` and returns version `N + 1`; loading runs every required migration in order, validates the final result, and only then makes it available to the page. The existing history array is likewise treated as history version 0 and is migrated to a `{ schemaVersion, entries }` envelope under the same existing history key. Unknown future versions are not overwritten: they produce a recoverable compatibility error and an in-memory default state. Unit tests cover every supported version-to-version step as well as the full version-0-to-current path.

### `core/random.js`

Owns Fisher-Yates shuffle, no-adjacent layout generation, and weighted selection. Every function accepts an optional random-number function so tests can be deterministic.

### `core/game-rules.js`

Owns copy changes, elimination, instant-winner resolution, returning a game, and terminal winner detection. Functions return new state or explicit result objects rather than changing the DOM.

### Build page

`build-page.js` coordinates state and events. `game-list-view.js` renders list and history elements and emits semantic callbacks. Twitch additions enter through the same build-page command as manual additions.

### Draw page

`draw-page.js` is the round coordinator. It owns the application-level phase and is the only draw module allowed to commit game-rule changes or persistence. `controls.js` maps the current phase to enabled and disabled controls. `draw-log.js` owns log rendering and scrolling.

Each visualization implements the same lifecycle:

```js
visualization.render(model)
const result = await visualization.play({ target, durationMs, signal })
visualization.cancel()
visualization.destroy()
```

Visualizations receive immutable render models and return a discriminated, mode-specific result. They do not pick winners, decrement copies, write storage, or edit the round log.

```js
// JSDoc-level public result contract; TypeScript is not required.
{ kind: 'slot-complete', targetId }
{ kind: 'wheel-complete', targetId, landedSectorIndex }
{ kind: 'battle-complete', eliminatedIds, survivorId }
```

The `AbortSignal` is the cooperative cancellation channel for the currently awaited `play()` call. Aborting that external signal and calling `cancel()` have the same observable result: the pending `play()` rejects with an `AbortError` and applies no result. `cancel()` is an idempotent imperative cleanup operation that stops the current animation state; calling it more than once has no additional effect. `destroy()` is permanent teardown: it calls `cancel()`, removes persistent listeners and observers, releases rendering resources, and makes subsequent `render()` or `play()` calls invalid.

## Round State Machine

The draw page uses explicit phases:

```text
idle -> animating -> awaiting-wheel-decision -> resolving -> idle
                                                |
                                                +-> finished

animating | awaiting-wheel-decision | resolving
    -- cancel/error --> idle (no result commit)
```

Battle Royale uses `idle -> animating -> resolving -> finished` or returns to `idle` if more than one eligible game remains.

At round start, the coordinator selects exactly one target with `weightedPick()`, creates an `AbortController`, disables conflicting controls, and asks the active visualization to play. State changes occur only after successful animation completion and, for Wheel, after the keep/remove decision.

For Wheel specifically, fulfillment of `play()` means only that the wheel landed and the UI may enter `awaiting-wheel-decision`; it does not commit a round. The selected target, landed sector, round counter, log/history entry, and copy changes remain provisional. Choosing Keep commits the round record without changing copies. Choosing Remove commits the round record and the requested copy/game removal. Cancelling, navigating away, or encountering an error before that choice commits nothing.

Cancellation aborts animation frames, Web Animations, timers, and temporary event listeners. A `finally` path applies the formal cancel/error transition, restores `idle` controls, and discards the provisional result without persistence.

## Control Locking

During `animating`, `awaiting-wheel-decision`, and `resolving`, disable:

- Slot, Wheel, and Battle mode buttons;
- shuffle variants;
- copy steppers;
- duration input;
- instant-winner input;
- start-round button;
- back navigation;
- log return buttons.

During `awaiting-wheel-decision`, only the Wheel keep/remove actions remain enabled. Disabled controls must use native `disabled` state so keyboard and assistive-technology behavior matches the visual state. The Back control remains a `<button>` rather than an anchor so it participates in this native locking contract.

## Wheel Behavior

- Store one canonical sector order in the Wheel controller.
- Reconcile composition changes without a full reshuffle:
  - game removal removes all entries for that game;
  - a round-result removal removes the exact `landedSectorIndex` returned by `play()`;
  - another copy decrease removes the last matching entry;
  - a game addition or copy increase inserts each missing entry into the first circular gap, scanning from index 0, whose two neighbors have a different game ID; when no such gap exists, it inserts immediately after the matching entry with the largest clockwise distance to the next matching entry, measured as the number of intervening entries in canonical circular order rather than an angle from rendered geometry, breaking ties by the lowest index;
  - every insertion or removal preserves the relative order of all pre-existing entries.
- The explicit Shuffle action is the only operation that fully reshuffles the canonical order.
- Starting a round must not change sector order.
- Select one of the target game's existing sector indices without rebuilding the SVG.
- Maintain a single cumulative rotation value on one rotating element.
- Stop idle motion at its computed current angle and continue the round animation from that exact angle.
- Calculate the target angle from the preserved order, pointer position, full turns, and an interior sector offset with a safe edge margin.
- After any minimal reconciliation, equal-size sector geometry is recalculated for the new count without changing the canonical relative order.
- Respect `prefers-reduced-motion` with short non-spinning transitions while preserving the selected result.

## Slot Behavior

- Build a deterministic reel model containing sufficient leading and trailing items for the viewport.
- Insert the preselected target without creating an unintended adjacent duplicate when a valid alternative arrangement exists.
- Animate with a continuous velocity curve: a short acceleration, stable travel, and monotonic deceleration with no velocity jump at segment boundaries.
- Derive travel distance from duration and configured velocity, avoiding the current discontinuity where short durations use a fixed item count but longer durations scale differently.
- Commit the final inline transform before cancelling the Web Animation so the landed frame does not jump.
- Expose pure helpers for reel construction, target index, distance, and animation keyframes.
- Respect `prefers-reduced-motion` by landing quickly without high-speed scrolling.

## Battle Royale Behavior

- Keep physics and drawing in `battle.js`, separate from game-rule persistence.
- Use one animation loop with explicit start, stop, and destroy operations.
- Clamp frame delta after background-tab pauses.
- Report eliminated game IDs and the final survivor to the coordinator; the coordinator applies state changes and logging.
- Cancel pending card-removal timers when the mode or page is destroyed.

## Error Handling

- Invalid or missing saved state falls back to validated defaults while retaining recoverable games where possible.
- Storage write failures do not block the active session; they surface a nonfatal status message.
- A failed or cancelled animation cannot leave the page in an active phase or controls permanently disabled.
- Twitch network and authorization failures remain isolated from list editing and present actionable status text.
- Unexpected visualization errors are logged to the console and converted into an idle, retryable UI state without applying a draw result.

## Testing

### Vitest unit tests

Cover:

- state defaults, validation, migration, and storage failures;
- every sequential state/history migration and rejection of unknown future schema versions without overwriting stored data;
- deterministic weighted selection boundaries and copy-based probability inputs;
- Fisher-Yates and no-adjacent layouts, including impossible dominant-copy cases;
- copy removal, full elimination, instant winner, return-to-pool, and terminal winner rules;
- Wheel sector preservation, target-angle calculation, cumulative rotation, and edge margins;
- Wheel relative-order preservation after every add, copy increase, copy decrease, landed-sector removal, and full game removal operation;
- Slot reel construction and velocity continuity at every keyframe boundary;
- round phase transitions and control-lock maps;
- Battle physics helpers that do not require canvas rendering.

### Playwright browser tests

Serve the repository over local HTTP and cover:

- creating a game list and navigating to the draw page;
- preserving state and history across reloads;
- switching among all three modes while idle;
- disabling every conflicting control during a round;
- preserving Wheel label order from the idle frame into round animation;
- landing the pointer on a sector belonging to the selected target;
- keeping and removing a Wheel result;
- Slot landing at the selected target with no visible jump between the animated and committed final frame;
- cancelling active resources during page navigation or mode teardown;
- Battle completion and elimination persistence;
- instant-winner and final-winner flows;
- reduced-motion behavior;
- loading the production entry points with no page or console errors.

### Continuous integration

GitHub Actions installs development dependencies and runs unit tests followed by Playwright tests on pushes and pull requests. Production remains source-only and does not consume generated bundles.

## Migration Sequence

1. Add the test harness and baseline browser tests for current critical flows.
2. Extract and unit-test pure state, random, and game-rule modules without changing UI behavior.
3. Introduce the explicit round state machine and centralized control locking.
4. Replace Wheel with the canonical-order, continuous-angle implementation.
5. Replace Slot with continuous-velocity keyframes.
6. Extract Battle Royale and ensure complete lifecycle cancellation.
7. Move build-page and Twitch coordination to modules.
8. Remove `app.js`, old global scripts, and unreachable compatibility code after all entry points use modules.
9. Run the full browser suite against the final static layout and document local development commands.

Each step must leave a runnable static site and pass all tests completed up to that point.

## Acceptance Criteria

- The deployed URL and visible feature set remain unchanged.
- Starting a Wheel round does not reorder labels or reset the visible angle.
- The generated Slot velocity function is unit-tested to remain continuous and decelerate monotonically during its stopping phase; browser tests verify the observable landing and absence of a final-frame jump without relying on frame timing thresholds.
- Mode and conflicting controls are natively disabled for the entire active round and Wheel decision period.
- No animation frame, timer, or temporary event listener survives cancellation or teardown.
- Selection probabilities and elimination rules match the current documented behavior.
- Unit and browser suites pass in GitHub Actions.
- Neither HTML entry point loads `app.js` or the old monolithic draw implementation.
- GitHub Pages serves the application without a production build step.
