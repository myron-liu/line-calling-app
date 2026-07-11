"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  Division,
  GameStatus,
  GenderMatch,
  Game,
  ODPreference,
  Player,
  Role,
  Team,
  Tournament,
} from "@shared/game-rules";
import {
  createPlayer,
  deletePlayer,
  playerConflict,
  readPlayers,
  readTeam,
  updatePlayer,
  type PlayerInput,
} from "@/lib/storage/teams";
import {
  createTournament,
  readTournaments,
} from "@/lib/storage/tournaments";
import {
  deleteGame,
  updateGameMetadata,
  type GameMetadataPatch,
} from "@/lib/storage/games";
import { Modal } from "@/components/modal";
import {
  ROLE_BADGE_COLOR,
  displayName,
  odTag,
  roleTag,
  sortRoster,
} from "@/lib/player-display";
import { sameById, sameJson, useCachedFetch } from "@/lib/cache";
import { keys } from "@/lib/storage/keys";

interface TeamDetailData {
  team: Team;
  players: Player[];
  tournaments: Tournament[];
}

function sameTeamDetail(a: TeamDetailData, b: TeamDetailData): boolean {
  return (
    sameJson(a.team, b.team) &&
    sameById(a.players, b.players) &&
    sameById(a.tournaments, b.tournaments)
  );
}

export function TeamDetail({ teamId }: { teamId: string }) {
  const { data, refresh } = useCachedFetch<TeamDetailData | null>(
    keys.teamDetail(teamId),
    async () => {
      const [t, players, tournaments] = await Promise.all([
        readTeam(teamId),
        readPlayers(teamId),
        readTournaments(teamId),
      ]);
      return t ? { team: t, players, tournaments } : null;
    },
    (a, b) => (a === null || b === null ? a === b : sameTeamDetail(a, b)),
    [teamId],
  );

  if (!data) return <p className="text-muted">Loading…</p>;
  const { team, players, tournaments } = data;

  return (
    <section className="space-y-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">{team.name}</h1>
        <span className="text-xs uppercase tracking-wide text-faint">
          {team.division}
        </span>
      </div>

      <Roster
        teamId={teamId}
        division={team.division}
        players={players}
        onChange={refresh}
      />

      <Tournaments
        team={team}
        tournaments={tournaments}
        onCreate={async (name, startDate, endDate) => {
          await createTournament(teamId, name, team.division, startDate, endDate);
          await refresh();
        }}
      />
    </section>
  );
}

// ── Roster ───────────────────────────────────────────────────────────────────

function Roster({
  teamId,
  division,
  players,
  onChange,
}: {
  teamId: string;
  division: Division;
  players: Player[];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [genderMatch, setGenderMatch] = useState<GenderMatch>("MMP");
  const [role, setRole] = useState<Role>("cutter");
  const [odPreference, setOdPreference] = useState<ODPreference>("both");
  const [jersey, setJersey] = useState("");
  const [editing, setEditing] = useState<Player | null>(null);
  const [deleting, setDeleting] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<"all" | "handler" | "cutter">("all");
  const [odFilter, setOdFilter] = useState<"all" | "O" | "D">("all");

  const confirmDelete = () => {
    if (!deleting) return;
    deletePlayer(deleting.id)
      .then(() => {
        setDeleting(null);
        onChange();
      })
      .catch((err) => {
        setDeleting(null);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const matchesFilters = (p: Player) => {
    if (roleFilter === "handler" && p.role === "cutter") return false;
    if (roleFilter === "cutter" && p.role === "handler") return false;
    if (odFilter === "O" && p.odPreference === "D") return false;
    if (odFilter === "D" && p.odPreference === "O") return false;
    return true;
  };
  const filtered = players.filter(matchesFilters);
  const mmpPlayers = sortRoster(filtered.filter((p) => p.genderMatch === "MMP"));
  const wmpPlayers = sortRoster(filtered.filter((p) => p.genderMatch === "WMP"));

  const conflict = name.trim() ? playerConflict(players, { name, nickname }) : null;

  // Single-division teams don't need a gender-match choice at all — every
  // player on an Open roster is MMP, every player on a Women's roster is
  // WMP, by definition. Only Mixed (which needs both to fill the ratio)
  // shows the picker.
  const fixedGenderMatch: GenderMatch | null =
    division === "open" ? "MMP" : division === "women" ? "WMP" : null;

  const add = async () => {
    if (!name.trim() || conflict) return;
    try {
      await createPlayer(teamId, {
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        genderMatch: fixedGenderMatch ?? genderMatch,
        role,
        odPreference,
        jerseyNumber: jersey ? Number(jersey) : undefined,
      });
      setName("");
      setNickname("");
      setJersey("");
      setError(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="font-medium">
        Roster <span className="text-faint">({players.length})</span>
      </h2>

      {players.length === 0 ? (
        <div className="space-y-1 text-sm text-muted">
          <p>No players yet.</p>
          <p>
            {division === "mixed"
              ? "Add at least 4 MMP players and 4 WMP players to form a mixed team that can compete in tournaments."
              : "Add at least 7 players to form a team that can compete in tournaments."}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-faint">Role:</span>
            <FilterChip label="All" active={roleFilter === "all"} onClick={() => setRoleFilter("all")} />
            <FilterChip
              label="Handlers"
              active={roleFilter === "handler"}
              onClick={() => setRoleFilter("handler")}
            />
            <FilterChip
              label="Cutters"
              active={roleFilter === "cutter"}
              onClick={() => setRoleFilter("cutter")}
            />
            <span className="ml-2 text-faint">Line:</span>
            <FilterChip label="All" active={odFilter === "all"} onClick={() => setOdFilter("all")} />
            <FilterChip label="O" active={odFilter === "O"} onClick={() => setOdFilter("O")} />
            <FilterChip label="D" active={odFilter === "D"} onClick={() => setOdFilter("D")} />
          </div>

          {division === "mixed" ? (
            <>
              <RosterAccordion
                label="MMP"
                tone="sky"
                players={mmpPlayers}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
              <RosterAccordion
                label="WMP"
                tone="rose"
                players={wmpPlayers}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            </>
          ) : (
            // Single-division team: every player is the same genderMatch by
            // definition, so the MMP/WMP split is a redundant grouping — just
            // one flat list, no accordion chrome.
            <FlatRosterList
              players={division === "open" ? mmpPlayers : wmpPlayers}
              tone={division === "open" ? "sky" : "rose"}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          )}
        </>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line-strong p-3 text-sm">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Player name"
          className="h-9 min-w-[8rem] flex-1 rounded border border-line-strong px-2"
        />
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Nickname"
          className="h-9 min-w-[7rem] flex-1 rounded border border-line-strong px-2"
        />
        {!fixedGenderMatch && (
          <select
            value={genderMatch}
            onChange={(e) => setGenderMatch(e.target.value as GenderMatch)}
            className="h-9 rounded border border-line-strong px-2"
          >
            <option value="MMP">MMP</option>
            <option value="WMP">WMP</option>
          </select>
        )}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="h-9 rounded border border-line-strong px-2"
        >
          <option value="handler">Handler</option>
          <option value="cutter">Cutter</option>
          <option value="both">Both</option>
        </select>
        <select
          value={odPreference}
          onChange={(e) => setOdPreference(e.target.value as ODPreference)}
          className="h-9 rounded border border-line-strong px-2"
        >
          <option value="O">O</option>
          <option value="D">D</option>
          <option value="both">O/D</option>
        </select>
        <input
          value={jersey}
          onChange={(e) => setJersey(e.target.value.replace(/\D/g, ""))}
          placeholder="#"
          inputMode="numeric"
          className="h-9 w-14 rounded border border-line-strong px-2"
        />
        <button
          onClick={add}
          disabled={!name.trim() || !!conflict}
          className="h-9 rounded bg-emerald-600 px-3 font-medium text-white disabled:bg-disabled"
        >
          Add
        </button>
        {conflict && (
          <p className="w-full text-xs text-red-600 dark:text-red-400">{conflict}</p>
        )}
        {!conflict && error && (
          <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      {editing && (
        <EditPlayerModal
          players={players}
          player={editing}
          division={division}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(null)}>
          <h2 className="font-medium">Remove player?</h2>
          <p className="text-sm text-muted">
            Remove {displayName(deleting)} from the roster? This can’t be undone.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setDeleting(null)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FilterChip({
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
      className={`rounded-full border px-2 py-0.5 ${
        active
          ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-line-strong text-faint"
      }`}
    >
      {label}
    </button>
  );
}

const ROSTER_TONE = {
  sky: {
    border: "border-sky-200 dark:border-sky-500/30",
    text: "text-sky-600 dark:text-sky-400",
  },
  rose: {
    border: "border-rose-200 dark:border-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
  },
} as const;

function FlatRosterList({
  players,
  tone,
  onEdit,
  onDelete,
}: {
  players: Player[];
  tone: keyof typeof ROSTER_TONE;
  onEdit: (p: Player) => void;
  onDelete: (p: Player) => void;
}) {
  const t = ROSTER_TONE[tone];
  return (
    <ul className="grid grid-cols-2 gap-1.5">
      {players.length === 0 ? (
        <li className="col-span-2 text-[13px] text-faint">
          No players match the current filters.
        </li>
      ) : (
        players.map((p) => (
          <RosterRow key={p.id} p={p} tone={t} onEdit={onEdit} onDelete={onDelete} />
        ))
      )}
    </ul>
  );
}

function RosterAccordion({
  label,
  tone,
  players,
  onEdit,
  onDelete,
}: {
  label: string;
  tone: keyof typeof ROSTER_TONE;
  players: Player[];
  onEdit: (p: Player) => void;
  onDelete: (p: Player) => void;
}) {
  const t = ROSTER_TONE[tone];
  return (
    <details open className={`rounded-lg border p-2 ${t.border}`}>
      <summary className={`cursor-pointer text-sm font-semibold ${t.text}`}>
        {label} <span className="font-normal text-faint">({players.length})</span>
      </summary>
      <ul className="mt-2 grid grid-cols-2 gap-1.5">
        {players.length === 0 ? (
          <li className="col-span-2 text-[13px] text-faint">
            No players match the current filters.
          </li>
        ) : (
          players.map((p) => (
            <RosterRow key={p.id} p={p} tone={t} onEdit={onEdit} onDelete={onDelete} />
          ))
        )}
      </ul>
    </details>
  );
}

function RosterRow({
  p,
  tone,
  onEdit,
  onDelete,
}: {
  p: Player;
  tone: (typeof ROSTER_TONE)[keyof typeof ROSTER_TONE];
  onEdit: (p: Player) => void;
  onDelete: (p: Player) => void;
}) {
  return (
    <li className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-[13px] ${tone.border}`}>
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span
          className={`shrink-0 rounded px-1 text-[10px] font-semibold ${ROLE_BADGE_COLOR[p.role]}`}
        >
          {roleTag(p.role)}
        </span>
        <span className="min-w-0 flex-1 truncate">{displayName(p)}</span>
        <span className="shrink-0 text-[10px] text-faint">{odTag(p.odPreference)}</span>
      </span>
      <button
        onClick={() => onEdit(p)}
        aria-label={`Edit ${p.name}`}
        title="Edit player"
        className="shrink-0 text-faint hover:text-fg"
      >
        <EditIcon />
      </button>
      <button
        onClick={() => onDelete(p)}
        aria-label={`Remove ${p.name}`}
        className="shrink-0 text-faint hover:text-red-600 dark:text-red-400"
      >
        ×
      </button>
    </li>
  );
}

// Small pencil icon — no icon library dependency, just an inline SVG.
function EditIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path
        d="M13.5 3.5l3 3L7 16l-4 1 1-4 9.5-9.5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Edit player modal ────────────────────────────────────────────────────────────

function EditPlayerModal({
  players,
  player,
  division,
  onClose,
  onSaved,
}: {
  players: Player[];
  player: Player;
  division: Division;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(player.name);
  const [nickname, setNickname] = useState(player.nickname ?? "");
  const [genderMatch, setGenderMatch] = useState<GenderMatch>(player.genderMatch);
  const [role, setRole] = useState<Role>(player.role);
  const [odPreference, setOdPreference] = useState<ODPreference>(
    player.odPreference ?? "both",
  );
  const [error, setError] = useState<string | null>(null);

  // Same single-division rule as the roster-addition form: Open/Women teams
  // don't get a gender-match choice at all.
  const fixedGenderMatch: GenderMatch | null =
    division === "open" ? "MMP" : division === "women" ? "WMP" : null;

  const conflict = name.trim()
    ? playerConflict(players, { name, nickname }, player.id)
    : "Name is required.";

  const save = async () => {
    if (conflict) return;
    const patch: Partial<PlayerInput> = {
      name: name.trim(),
      nickname: nickname.trim() || undefined,
      genderMatch: fixedGenderMatch ?? genderMatch,
      role,
      odPreference,
    };
    try {
      await updatePlayer(player.id, patch);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="font-medium">Edit player</h2>
      <div className="space-y-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 rounded border border-line-strong px-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Nickname</span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="h-9 rounded border border-line-strong px-2"
          />
        </label>
        {!fixedGenderMatch && (
          <label className="flex flex-col gap-1">
            <span className="text-muted">Gender match</span>
            <select
              value={genderMatch}
              onChange={(e) => setGenderMatch(e.target.value as GenderMatch)}
              className="h-9 rounded border border-line-strong px-2"
            >
              <option value="MMP">MMP</option>
              <option value="WMP">WMP</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-muted">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="h-9 rounded border border-line-strong px-2"
          >
            <option value="handler">Handler</option>
            <option value="cutter">Cutter</option>
            <option value="both">Both</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">O/D preference</span>
          <select
            value={odPreference}
            onChange={(e) => setOdPreference(e.target.value as ODPreference)}
            className="h-9 rounded border border-line-strong px-2"
          >
            <option value="O">O</option>
            <option value="D">D</option>
            <option value="both">O/D</option>
          </select>
        </label>
      </div>

      {conflict && name.trim() && (
        <p className="text-xs text-red-600 dark:text-red-400">{conflict}</p>
      )}
      {!conflict && error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onClose}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!!conflict}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-disabled"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

// ── Tournaments ────────────────────────────────────────────────────────────────

function Tournaments({
  team,
  tournaments,
  onCreate,
}: {
  team: Team;
  tournaments: Tournament[];
  onCreate: (name: string, startDate: string, endDate?: string) => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");

  const endDateInvalid = endDate !== "" && endDate < startDate;

  return (
    <div className="space-y-3">
      <h2 className="font-medium">Tournaments</h2>
      {tournaments.length === 0 ? (
        <p className="text-sm text-muted">No tournaments yet.</p>
      ) : (
        <ul className="space-y-2">
          {tournaments.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-line px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{t.name}</p>
                <p className="text-xs text-faint">
                  {t.endDate && t.endDate !== t.startDate
                    ? `${t.startDate} – ${t.endDate}`
                    : t.startDate}
                </p>
              </div>
              <Link
                href={`/tournaments/${t.id}`}
                className="shrink-0 rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-surface-2 dark:text-emerald-400"
              >
                View tournament →
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-start gap-2 rounded-lg border border-dashed border-line-strong p-3 text-sm">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tournament name"
          className="h-9 min-w-[8rem] flex-1 rounded border border-line-strong px-2"
        />
        <input
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            if (endDate && endDate < e.target.value) setEndDate(e.target.value);
          }}
          className="h-9 rounded border border-line-strong px-2"
        />
        <input
          type="date"
          value={endDate}
          min={startDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder="End date"
          className="h-9 rounded border border-line-strong px-2"
        />
        <button
          onClick={() => {
            if (!name.trim() || endDateInvalid) return;
            onCreate(name.trim(), startDate, endDate || undefined);
            setName("");
            setEndDate("");
          }}
          disabled={!name.trim() || endDateInvalid}
          className="h-9 rounded bg-emerald-600 px-3 font-medium text-white disabled:bg-disabled"
        >
          Create
        </button>
      </div>
      {endDateInvalid && (
        <p className="text-xs text-red-600 dark:text-red-400">
          End date can&rsquo;t be before the start date.
        </p>
      )}
    </div>
  );
}

// ── Shared: game list ────────────────────────────────────────────────────────

const statusLabel: Record<GameStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
};

export function GameList({
  games,
  emptyLabel,
  tournamentStartDate,
  tournamentEndDate,
}: {
  games: Game[];
  emptyLabel: string;
  /** Constrains the edit modal's game-date picker, for a tournament game. */
  tournamentStartDate?: string;
  tournamentEndDate?: string;
}) {
  const [list, setList] = useState(games);
  useEffect(() => setList(games), [games]);
  const [editing, setEditing] = useState<Game | null>(null);
  const [deleting, setDeleting] = useState<Game | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = () => {
    if (!deleting) return;
    deleteGame(deleting.id)
      .then(() => {
        setList((cur) => cur.filter((g) => g.id !== deleting.id));
        setDeleting(null);
        setDeleteError(null);
      })
      .catch((err) => {
        setDeleteError(err instanceof Error ? err.message : String(err));
      });
  };

  if (list.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }
  return (
    <>
      <ul className="space-y-2">
        {list.map((g) => (
          <li
            key={g.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-line px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">vs {g.opponentName}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
                <span>
                  {statusLabel[g.status]} ·{" "}
                  {g.gameCap === null ? "time cap" : `cap ${g.gameCap}`}
                </span>
                {g.status === "in_progress" && g.currentScore && (
                  <span className="font-semibold tabular-nums text-fg">
                    {g.currentScore.our}–{g.currentScore.their}
                    {g.currentPointNumber !== undefined && (
                      <span className="font-normal text-faint">
                        {" "}
                        · Point {g.currentPointNumber}
                      </span>
                    )}
                  </span>
                )}
                {g.status !== "scheduled" && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${
                      g.startingOD === "O" ? "bg-sky-600" : "bg-orange-600"
                    }`}
                  >
                    Started {g.startingOD}
                  </span>
                )}
                {g.fieldSide && (
                  <span>{g.fieldSide === "left" ? "Left" : "Right"} side</span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-sm">
              <button
                onClick={() => setEditing(g)}
                aria-label={`Edit game vs ${g.opponentName}`}
                title="Edit game"
                className="text-faint hover:text-fg"
              >
                <EditIcon />
              </button>
              <button
                onClick={() => setDeleting(g)}
                aria-label={`Delete game vs ${g.opponentName}`}
                title="Delete game"
                className="text-faint hover:text-red-600 dark:text-red-400"
              >
                ×
              </button>
              <Link
                href={`/games/${g.id}`}
                className="rounded-md border border-line-strong px-2.5 py-1 font-medium hover:bg-surface-2"
              >
                View game →
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <EditGameModal
          game={editing}
          tournamentStartDate={tournamentStartDate}
          tournamentEndDate={tournamentEndDate}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setList((cur) => cur.map((g) => (g.id === updated.id ? updated : g)));
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <Modal
          onClose={() => {
            setDeleting(null);
            setDeleteError(null);
          }}
        >
          <h2 className="font-medium">Delete game?</h2>
          <p className="text-sm text-muted">
            Delete the game vs {deleting.opponentName}? This can’t be undone.
          </p>
          {deleteError && (
            <p className="text-xs text-red-600 dark:text-red-400">{deleteError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setDeleting(null);
                setDeleteError(null);
              }}
              className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function EditGameModal({
  game,
  tournamentStartDate,
  tournamentEndDate,
  onClose,
  onSaved,
}: {
  game: Game;
  tournamentStartDate?: string;
  tournamentEndDate?: string;
  onClose: () => void;
  onSaved: (game: Game) => void;
}) {
  const [opponentName, setOpponentName] = useState(game.opponentName);
  const [fieldNumber, setFieldNumber] = useState(game.fieldNumber ?? "");
  const [gameDate, setGameDate] = useState(game.gameDate ?? "");
  const [startTime, setStartTime] = useState(game.startTime ?? "");
  const [opposingCoachName, setOpposingCoachName] = useState(game.opposingCoachName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gameDateInvalid =
    gameDate !== "" &&
    ((tournamentStartDate !== undefined && gameDate < tournamentStartDate) ||
      (tournamentEndDate !== undefined && gameDate > tournamentEndDate));

  const save = async () => {
    if (!opponentName.trim() || gameDateInvalid) return;
    setSaving(true);
    setError(null);
    try {
      const patch: GameMetadataPatch = {
        opponentName: opponentName.trim(),
        fieldNumber: fieldNumber.trim() || null,
        gameDate: gameDate || null,
        startTime: startTime.trim() || null,
        opposingCoachName: opposingCoachName.trim() || null,
      };
      const updated = await updateGameMetadata(game.id, patch);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="font-medium">Edit game</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-muted">Opponent</span>
          <input
            value={opponentName}
            onChange={(e) => setOpponentName(e.target.value)}
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Field number</span>
          <input
            value={fieldNumber}
            onChange={(e) => setFieldNumber(e.target.value)}
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Game date</span>
          <input
            type="date"
            value={gameDate}
            min={tournamentStartDate}
            max={tournamentEndDate}
            onChange={(e) => setGameDate(e.target.value)}
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Start time</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Opposing coach</span>
          <input
            value={opposingCoachName}
            onChange={(e) => setOpposingCoachName(e.target.value)}
            className="rounded border border-line-strong px-3 py-2"
          />
        </label>
      </div>
      {gameDateInvalid && (
        <p className="text-xs text-red-600 dark:text-red-400">
          Game date must fall within the tournament ({tournamentStartDate}
          {tournamentEndDate ? ` – ${tournamentEndDate}` : ""}).
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onClose}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!opponentName.trim() || gameDateInvalid || saving}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-disabled"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
