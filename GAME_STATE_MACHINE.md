# Game state machine & sync

This documents the one state machine that matters most in this app — a single
game, from creation to final score — and how multi-device sync/conflict
resolution is scoped around it. Source of truth for all of this is
`packages/game-rules/src/state.ts` (the pure reducers) plus
`apps/web/lib/game/useLiveGame.ts` and `apps/server/src/db/queries.ts` (how the
reducers get wired to storage and to other devices).

## 1. The two layers of state

A game has **two** state machines, one nested inside the other:

- **`game.status`** (`"scheduled" | "in_progress" | "completed"`, persisted in
  the `games` table) — the coarse lifecycle: has the coin flip happened yet,
  and is the game over.
- **`LiveGameState.phase`** (`"awaiting_line" | "point_in_progress" |
  "completed"`, *derived*, never persisted directly — recomputed on every
  render by `deriveLiveGameState(game, points, meta)` from the point log) —
  which of the two live-caller screens is showing, once `status` is
  `"in_progress"`.

```
 status:  scheduled ──resolveFlip──▶ in_progress ─────────▶ completed
              ▲                          │  ▲
              └──────undoFlip────────────┘  │ (naturally reaching the
                                             │  cap, or a manual endGame)
 phase (only defined once in_progress):
   awaiting_line ──confirmLine──▶ point_in_progress ──recordResult──▶ awaiting_line ──▶ … ──▶ completed
```

### 1a. The flip sub-machine (`resolveFlip` / `undoFlip`)

A game is created in `"scheduled"` status with the flip-dependent fields
unset: `fieldSide`, `teamColor`, `startingGenderRatio` (mixed-division only)
are `null`, and `startingOD` holds an unread placeholder (`"O"`) — nothing
reads it while `status === "scheduled"`. The **field number, game date, start
time, and opposing coach name** *are* collected at creation time, since
they're usually known in advance; the flip-dependent fields are usually only
known right before the game starts, so they're deferred to a dedicated
"what did the flip decide?" screen (`FlipResultForm` in `game-screen.tsx`).

- **`resolveFlip(gameId, { fieldSide, teamColor, startingOD, startingGenderRatio? })`**
  — `scheduled → in_progress`. Throws if the game isn't currently
  `"scheduled"` (a one-time transition, not idempotent).
- **`undoFlip(gameId)`** — `in_progress → scheduled`, clearing all four fields
  back to their unset/placeholder values. Guarded: throws unless the game is
  currently `"in_progress"` **and** it has zero recorded points yet. Once a
  point exists, its O/D and gender ratio were derived from the resolved flip,
  so rewinding the flip out from under real history would desync the log.
  The live caller only shows the "Undo flip" control while `points.length
  === 0` (see `SecondaryControls` in `live-caller.tsx`), so in practice the
  guard never actually fires from the UI — it exists because the endpoint
  itself must not trust the client.

Neither of these — nor the separate `PATCH /games/:id/metadata` used to edit
opponent name / field number / date / time / coach after creation — bumps
`games.version` (see §3). They're considered administrative, not part of the
point-log's own transition history, and are intentionally exempt from
optimistic-concurrency conflicts: last write wins, and every other open
viewer just gets told to refresh (see §3's two sync channels).

### 1b. The point-log FSM (`packages/game-rules/src/state.ts`)

Once `in_progress`, everything is driven by an append-only list of `Point`s
plus a small `GameMeta` (timeouts remaining per side, `halftimeReached`,
`endedManually`). The reducers:

| Reducer | Phase before | Phase after | What it does |
|---|---|---|---|
| `confirmLine(game, state, lineup, pointId)` | `awaiting_line` | `point_in_progress` | Appends a new `Point` with the lineup, snapshotting the current O/D and gender ratio; no `result` yet. |
| `recordResult(game, state, scorer)` | `point_in_progress` | `awaiting_line` (or `completed` if the cap is reached) | Sets the current point's `result`, advances the score, flips O/D, advances the ABBA gender-ratio cycle. Crossing `halfScore` auto-sets `halftimeReached` and resets both timeout counts. |
| `callHalftime(game, state)` | any | unchanged | Idempotent: sets `halftimeReached` and resets timeouts, for a manual call before the score naturally reaches half. The UI (not the reducer) additionally forbids calling this while `phase === "point_in_progress"` — halftime is only callable between points, on the awaiting-line screen. |
| `callTimeout(state, team)` | any | unchanged | Decrements that side's remaining timeouts; throws at zero. |
| `injurySub(state, injuredId, replacementId)` | `point_in_progress` | unchanged | Records a hot-sub on the current point; the injured player still counts as having played it. |
| `editPointLineup(state, pointId, newLineup)` | any | unchanged | Rewrites a **past** point's lineup only — an audit correction, never touches score or the current point. |
| `endGame(state)` | any | `completed` | Sets `endedManually`, regardless of the cap. |
| `undoLastPoint(game, state)` | any (post point 1) | one step back | See below. |
| `redoAction(game, state, action)` | — | replays exactly what undo reverted | See below. |

#### Undo — one step, phase-aware

`undoLastPoint` reverses whichever single transition most recently moved the
game forward, in this priority order:

1. **`endedManually`** → un-end (clear the flag; the phase falls back to
   whatever the score/cap implies). Redo: `{ type: "endGame" }`.
2. **`halftimeReached` but not because the score actually crossed
   `halfScore`** (i.e. a manual `callHalftime` tap) → clear the flag. The
   pre-halftime timeout counts aren't restored — there's no record of what
   they were, so this is an accepted, low-stakes limitation of undoing an
   accidental tap. Redo: `{ type: "callHalftime" }`.
3. **Zero points recorded** → throws (`"Nothing to undo"`). This is
   deliberately *not* where flip-undo lives — see §1a; that's a wholly
   separate mechanism with its own button.
4. **The last point has no `result` yet** (currently `point_in_progress`,
   the "We scored / They scored" screen) → un-confirm its line, back to
   `awaiting_line` for the *same* point, with the lineup restored so the
   coach can re-pick or just re-confirm it. Redo:
   `{ type: "confirmLine", lineup, pointId }`.
5. **Otherwise** (last point already decided, currently `awaiting_line` for
   the next point) → un-record *just* that result, back to
   `point_in_progress` for it — the point and its lineup are untouched.
   If this crosses back before `halfScore`, timeouts reset to the per-half
   baseline. Redo: `{ type: "recordResult", scorer }`.

`redoAction` just re-dispatches the corresponding reducer from the `redo`
descriptor above (`confirmLine` / `recordResult` / `endGame` / `callHalftime`)
— redo can never drift from undo because it isn't a second, hand-maintained
code path.

#### Undo/redo button labels

The label shown to the coach is derived from which case above actually
fired — never a generic "Undo" — so the button always says exactly what it's
about to do:

| Case | Button label |
|---|---|
| `endGame` | **Undo end** / **Redo end** |
| `callHalftime` | **Undo halftime** / **Redo halftime** |
| `confirmLine` (case 4 — the "We scored/They scored" screen) | **Undo line** / **Redo line** |
| `recordResult` (case 5 — the awaiting-line screen) | **Undo point** / **Redo point** |
| flip (§1a, separate control, no redo counterpart) | **Undo flip** |

`useLiveGame.ts` derives the undo label by calling `undoLastPoint` purely for
its `redo.type` (it's a pure function, so "peeking" at what it would do is
side-effect-free) and mapping that through the same table `redoAction` itself
switches on — one source of truth, not a parallel copy that could drift.

## 2. Where this state actually lives

The client is authoritative for a live game: it runs every reducer above
entirely offline-first, storing the point log, meta, and roster snapshot in
`localStorage` (`apps/web/lib/storage/gameLog.ts`). The server never
re-derives anything — it durably stores whatever the client already computed.

- Every reducer call goes through `useLiveGame.ts`'s `commit()`, which:
  writes to `localStorage` immediately, enqueues an **outbox** event (so a
  commit made while offline survives a reload and retries later —
  `apps/web/lib/storage/outbox.ts`), and fires a `PUT /games/:id/sync` in the
  background with the full current `{ meta, points, roster, version }`.
- The server's `syncGame` (`apps/server/src/db/queries.ts`) replaces its
  copy of the points/meta/roster wholesale (delete + reinsert — a game's log
  is small, so this sidesteps partial-update bugs around undo/redo rewriting
  earlier points) rather than replaying individual events.

## 3. Conflict resolution — two independent channels

There are **two** separate SSE-backed systems in `apps/server/src/sse.ts`,
namespaced onto distinct channel keys in the same subscriber map so they can
never cross-talk:

### 3a. Game-state sync (versioned, can conflict)

Scope: the point log/meta/roster fields above — the actual gameplay
transitions. **Not** in scope: flip resolution/undo, or administrative
metadata edits (see §1a) — those bypass versioning entirely by design, since
"sync conflicts" should only ever be about the game's actual transition
history, not its paperwork.

- `games.version` is a plain integer, bumped by exactly one write path:
  `syncGame`'s `UPDATE ... WHERE id = ? AND version = ?`. Two concurrent
  syncs against the same starting version can't both land — only the first
  to commit bumps the version and returns a row; the loser's `WHERE` clause
  matches nothing.
- **Conflict**: a stale `version` comes back as `409`, with the server's
  current full state attached in the body. The client does not attempt to
  merge — the transition it just computed was derived from data the server
  has already moved past, so it's simply discarded, and the server's state is
  adopted wholesale (`adoptServerState` in `useLiveGame.ts`), surfacing:
  *"This game was updated from another device since your last sync — local
  changes were replaced with the latest data from the server."*
- **Real-time push**: `GET /games/:id/events`, channel-keyed by the game's own
  id. `broadcast(gameId, ...)` fires on every successful `/sync`,
  `/resolve-flip`, `/undo-flip`, and metadata edit, so any other open tab for
  that game learns about it immediately — not only the next time it tries
  (and fails) to write.
- **Self-notification guard**: the server broadcasts to *every* subscriber of
  a game's channel, including the tab that just wrote — and it does so
  *before* that tab's own `PUT /sync` response comes back (`broadcast()` runs
  synchronously in the route handler, before `return json(...)`). If the SSE
  push is processed first, the writer's own handler would otherwise see its
  own commit as a version bump from "another device." The fix: the SSE
  handler skips reacting if this device currently has a pending (not yet
  acknowledged) outbox event for the game — that in-flight write's own
  `flush().then()` will reconcile things correctly either way (a clean
  success, or, if the game genuinely was overtaken in between, a real `409`).
  Without this guard, a coach acting completely alone on one device would
  routinely see the "another device" message for their own actions.

### 3b. Saved lines/pods sync (no versioning — pure cache invalidation)

Scope: creating, editing, using (`useCount`), and deleting a saved
line/pod — a team-scoped, independently reusable resource, not part of any
one game's transition history.

- These mutate through their own endpoints (`POST /teams/:id/saved-lines`,
  `PATCH /saved-lines/:id`, `POST /saved-lines/:id/use`,
  `DELETE /saved-lines/:id`), which never read or write `games.version` and
  never go through `commit()`/the outbox — so by construction they cannot
  cause (or be affected by) a game-sync conflict.
- **Real-time push**: `GET /teams/:id/saved-lines/events`, channel-keyed by
  `lines:<teamId>` — deliberately namespaced apart from a raw `gameId` so the
  two systems can't collide in the shared subscriber map. Every mutation
  broadcasts `{ type: "updated" }` on this channel; any open live caller for
  that team just refetches its saved-lines list in response. There is no
  merge/replace-state logic here at all — it's a plain "go re-fetch," and it
  can never trigger the game-conflict message.
- **Same-name collisions are a merge, not a conflict**: two coaches
  independently naming a pod (e.g. both call something "O-line") doesn't
  round-trip through version checks at all. `createSavedLine`/
  `updateSavedLine` check for an existing line with the same
  (case/whitespace-insensitive) name: identical personnel → reuse the
  existing row; different personnel → the new call is the newer definition
  and supersedes the old row in place. Either way there's one row, not two,
  and no error surfaced to either coach.

## 4. Worked examples

1. **A real cross-device conflict.** Coach A confirms a line on their phone,
   then loses signal before syncing. Meanwhile coach B (a second phone open
   to the same game) records a point result and syncs successfully
   (`version` 5 → 6). When coach A's phone reconnects and flushes its queued
   commit (still stamped `version: 5`), the server rejects it `409` with its
   state at version 6; coach A's phone discards its own now-stale transition
   and adopts version 6, correctly showing "updated from another device."
2. **Two tabs, one laptop, no real conflict.** The same game is open in two
   tabs for testing. Tab 1 confirms a line (bumping the server to version 6).
   The self-notification guard means Tab 1 doesn't misreport this as
   "another device." Tab 2 — which has no pending write of its own — gets
   the same SSE push and just refreshes silently (`hadPending` is false for
   a passive viewer, so no message is shown).
3. **Saving a pod never touches game sync.** A coach saves a new pod named
   "O2" from inside a live game. Any other device with that team's live
   caller open refetches its saved-lines list over the separate
   `lines:<teamId>` channel a moment later — with zero effect on that
   device's own game `version`/sync status, and no "updated from another
   device" message, since that message is exclusively wired to the game
   channel in §3a.
4. **A naming collision that isn't a conflict.** Two coaches, on two
   devices, each save a 7-person pod named "O-line" with the exact same
   players, moments apart. The second `createSavedLine` call detects the
   name collision, confirms the personnel matches, and just returns the
   first call's row (same id, no duplicate) — no version check, no error,
   no message on either device.
5. **Undoing a flip vs. undoing a point.** A coach resolves the flip
   (`scheduled → in_progress`), then immediately taps "Undo flip" before
   calling any line — the game reverts to `scheduled` and the flip form
   reappears. Once the first line is confirmed, that control disappears;
   an "Undo" from then on is a point-log undo (labeled "Undo line" or "Undo
   point" per §1b), never a flip revert.
