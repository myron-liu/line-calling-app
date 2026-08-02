"use client";

import { useMemo, useState } from "react";
import type { Point, PointEdit, Scoring, StatEvent } from "@shared/game-rules";
import { Modal } from "@/components/modal";
import { isRosterActive, type RosterSnapshotEntry } from "@/lib/storage/gameLog";
import { displayName, sortRoster } from "@/lib/player-display";
import { newId } from "@/lib/id";

/**
 * Retroactive correction to one already-played point, opened from either
 * line-history surface (the live caller's tab and the end-game recap).
 *
 * Everything is edited as a local draft and committed in one go, so a
 * half-finished correction never lands in the log — and so the whole thing is
 * one entry in the sync queue rather than a dozen.
 */
export function PointEditModal({
  point,
  roster,
  strategyVocabulary,
  onClose,
  onSave,
}: {
  point: Point;
  /** Tags already in use this game, so re-tagging reuses the same vocabulary
   *  the live picker offers rather than inventing a parallel one. */
  strategyVocabulary: string[];
  /** The game's full roster snapshot — includes players no longer active, so
   *  a historical line still resolves every name on it. */
  roster: RosterSnapshotEntry[];
  onClose: () => void;
  onSave: (edit: PointEdit) => void;
}) {
  const [lineup, setLineup] = useState<string[]>(point.lineup);
  const [result, setResult] = useState(point.result);
  const [scoring, setScoring] = useState<Scoring | undefined>(point.scoring);
  const [events, setEvents] = useState<StatEvent[]>(point.statEvents ?? []);
  const [strategyTags, setStrategyTags] = useState<string[]>(point.strategyTags ?? []);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");

  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const nameOf = (id: string) => {
    const p = byId.get(id);
    return p ? displayName(p) : "Unknown";
  };
  const onLine = lineup
    .map((id) => byId.get(id))
    .filter((p): p is RosterSnapshotEntry => !!p);

  // Who can hold credit on this point. The starting line is not enough: a
  // player subbed on mid-point can absolutely get a D, and anyone *already*
  // credited has to stay selectable — otherwise their <select> would find no
  // matching option, silently fall back to the first name in the list, and
  // reassign their stat the moment the coach hit Save.
  const creditable = useMemo(() => {
    const ids = new Set(lineup);
    for (const s of point.substitutions ?? []) ids.add(s.replacementPlayerId);
    for (const e of events) ids.add(e.playerId);
    if (scoring?.kind === "callahan") ids.add(scoring.playerId);
    if (scoring?.kind === "goal") {
      ids.add(scoring.goalPlayerId);
      if (scoring.assistPlayerId) ids.add(scoring.assistPlayerId);
    }
    return sortRoster(roster.filter((p) => ids.has(p.playerId)));
  }, [lineup, events, scoring, point.substitutions, roster]);

  const save = () =>
    onSave({
      lineup,
      result,
      // null rather than undefined so "no scoring detail" actually clears a
      // previously-recorded one instead of being read as "leave alone".
      scoring: scoring ?? null,
      statEvents: events,
      strategyTags,
    });

  if (swapping) {
    // Anyone eligible and not already on this line. Injured players are
    // allowed here: this is a record of who *did* play, and they may well
    // have been healthy at the time.
    const bench = sortRoster(
      roster.filter((p) => isRosterActive(p) && !lineup.includes(p.playerId)),
    );
    return (
      <Modal onClose={() => setSwapping(null)}>
        <h2 className="font-medium">Replace {nameOf(swapping)} with</h2>
        {bench.length === 0 ? (
          <p className="text-sm text-muted">Nobody else on the roster.</p>
        ) : (
          <ul className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto">
            {bench.map((p) => (
              <li key={p.playerId}>
                <button
                  onClick={() => {
                    setLineup((cur) =>
                      cur.map((id) => (id === swapping ? p.playerId : id)),
                    );
                    // Anyone dropped off the line can't keep their credit.
                    setEvents((cur) => cur.filter((e) => e.playerId !== swapping));
                    setScoring((cur) => (scoringMentions(cur, swapping) ? undefined : cur));
                    setSwapping(null);
                  }}
                  className="w-full rounded-md border border-line px-2 py-2 text-left text-sm hover:border-line-strong"
                >
                  {displayName(p)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => setSwapping(null)}
          className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
        >
          ← Back
        </button>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="font-medium">Edit point {point.pointNumber}</h2>

      <Section label="Result">
        <div className="grid grid-cols-2 gap-2">
          <Choice
            label="We scored"
            active={result === "us"}
            onClick={() => setResult("us")}
          />
          <Choice
            label="They scored"
            active={result === "them"}
            onClick={() => {
              setResult("them");
              setScoring(undefined); // no goal to credit on a point we lost
            }}
          />
        </div>
      </Section>

      {result === "us" && (
        <Section label="Scored by">
          <ScoringEditor
            scoring={scoring}
            players={creditable}
            nameOf={nameOf}
            onChange={setScoring}
          />
        </Section>
      )}

      <Section label="Line">
        <p className="text-xs text-faint">Tap a player to swap them out.</p>
        <div className="flex flex-wrap gap-1.5">
          {onLine.map((p) => (
            <button
              key={p.playerId}
              onClick={() => setSwapping(p.playerId)}
              className="rounded-md border border-line px-2 py-1 text-sm hover:border-line-strong"
            >
              {displayName(p)}
            </button>
          ))}
        </div>
      </Section>

      <Section label="Strategy">
        <div className="flex flex-wrap gap-1.5">
          {Array.from(new Set([...strategyVocabulary, ...strategyTags])).map((tag) => (
            <button
              key={tag}
              onClick={() =>
                setStrategyTags((cur) =>
                  cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag],
                )
              }
              aria-pressed={strategyTags.includes(tag)}
              className={`rounded-full border px-2.5 py-1 text-sm ${
                strategyTags.includes(tag)
                  ? "border-violet-500 bg-violet-100 font-medium text-violet-800 dark:bg-violet-500/20 dark:text-violet-300"
                  : "border-line text-muted"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const name = newTag.trim();
              if (name && !strategyTags.includes(name)) {
                setStrategyTags((cur) => [...cur, name]);
              }
              setNewTag("");
            }}
            placeholder="New strategy…"
            className="flex-1 rounded border border-line-strong px-2 py-1 text-sm"
          />
        </div>
      </Section>

      <Section label="Ds & turnovers">
        <StatEventEditor
          events={events}
          players={creditable}
          nameOf={nameOf}
          onChange={setEvents}
        />
      </Section>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onClose}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

/** True if this scoring credit names the given player either way round. */
function scoringMentions(scoring: Scoring | undefined, playerId: string): boolean {
  if (!scoring) return false;
  return scoring.kind === "callahan"
    ? scoring.playerId === playerId
    : scoring.goalPlayerId === playerId || scoring.assistPlayerId === playerId;
}

function ScoringEditor({
  scoring,
  players,
  nameOf,
  onChange,
}: {
  scoring: Scoring | undefined;
  players: RosterSnapshotEntry[];
  nameOf: (id: string) => string;
  onChange: (scoring: Scoring | undefined) => void;
}) {
  const kind = scoring?.kind ?? "none";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Choice label="Goal" active={kind === "goal"} onClick={() =>
          onChange(
            scoring?.kind === "goal"
              ? scoring
              : { kind: "goal", goalPlayerId: players[0]?.playerId ?? "" },
          )
        } />
        <Choice label="Callahan" active={kind === "callahan"} onClick={() =>
          onChange(
            scoring?.kind === "callahan"
              ? scoring
              : { kind: "callahan", playerId: players[0]?.playerId ?? "" },
          )
        } />
        <Choice label="Not recorded" active={kind === "none"} onClick={() => onChange(undefined)} />
      </div>

      {scoring?.kind === "goal" && (
        <>
          <PlayerSelect
            label="Assist"
            value={scoring.assistPlayerId ?? ""}
            players={players}
            nameOf={nameOf}
            allowNone
            onChange={(id) =>
              onChange({ ...scoring, assistPlayerId: id || undefined })
            }
          />
          <PlayerSelect
            label="Goal"
            value={scoring.goalPlayerId}
            players={players}
            nameOf={nameOf}
            // The thrower can't also be the catcher, same as the live flow.
            excludeId={scoring.assistPlayerId}
            onChange={(id) => onChange({ ...scoring, goalPlayerId: id })}
          />
        </>
      )}

      {scoring?.kind === "callahan" && (
        <PlayerSelect
          label="Caught by"
          value={scoring.playerId}
          players={players}
          nameOf={nameOf}
          onChange={(id) => onChange({ kind: "callahan", playerId: id })}
        />
      )}
    </div>
  );
}

function StatEventEditor({
  events,
  players,
  nameOf,
  onChange,
}: {
  events: StatEvent[];
  players: RosterSnapshotEntry[];
  nameOf: (id: string) => string;
  onChange: (events: StatEvent[]) => void;
}) {
  const add = (type: StatEvent["type"]) => {
    const first = players[0]?.playerId;
    if (!first) return;
    onChange([...events, { id: newId(), playerId: first, type }]);
  };
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => add("block")}
          className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1.5 text-sm font-medium text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300"
        >
          + Defensive block
        </button>
        <button
          onClick={() => add("turnover")}
          className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          + Turnover
        </button>
      </div>
      {events.map((ev) => (
        <div key={ev.id} className="flex items-center gap-1.5">
          <span
            className={`w-6 shrink-0 rounded px-1 text-center text-[10px] font-semibold ${
              ev.type === "block"
                ? "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
            }`}
          >
            {ev.type === "block" ? "D" : "T"}
          </span>
          <select
            value={ev.playerId}
            onChange={(e) =>
              onChange(
                events.map((x) =>
                  x.id === ev.id ? { ...x, playerId: e.target.value } : x,
                ),
              )
            }
            className="flex-1 rounded border border-line-strong px-2 py-1 text-sm"
          >
            {players.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {nameOf(p.playerId)}
              </option>
            ))}
          </select>
          <button
            onClick={() => onChange(events.filter((x) => x.id !== ev.id))}
            aria-label="Remove"
            className="shrink-0 rounded px-2 py-1 text-xs text-muted hover:text-fg"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function PlayerSelect({
  label,
  value,
  players,
  nameOf,
  onChange,
  allowNone,
  excludeId,
}: {
  label: string;
  value: string;
  players: RosterSnapshotEntry[];
  nameOf: (id: string) => string;
  onChange: (playerId: string) => void;
  allowNone?: boolean;
  excludeId?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded border border-line-strong px-2 py-1"
      >
        {allowNone && <option value="">— none —</option>}
        {players
          .filter((p) => p.playerId !== excludeId)
          .map((p) => (
            <option key={p.playerId} value={p.playerId}>
              {nameOf(p.playerId)}
            </option>
          ))}
      </select>
    </label>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      {children}
    </div>
  );
}

function Choice({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2 py-1.5 text-sm ${
        active
          ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
          : "border-line text-muted"
      }`}
    >
      {label}
    </button>
  );
}
