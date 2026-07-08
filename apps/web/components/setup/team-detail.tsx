"use client";

import { useState } from "react";
import Link from "next/link";
import type {
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
import { Modal } from "@/components/modal";
import { displayName, odTag, roleTag, sortRoster } from "@/lib/player-display";
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

      <Roster teamId={teamId} players={players} onChange={refresh} />

      <Tournaments
        team={team}
        tournaments={tournaments}
        onCreate={async (name, date) => {
          await createTournament(teamId, name, team.division, date);
          await refresh();
        }}
      />
    </section>
  );
}

// ── Roster ───────────────────────────────────────────────────────────────────

function Roster({
  teamId,
  players,
  onChange,
}: {
  teamId: string;
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
  const [error, setError] = useState<string | null>(null);

  const conflict = name.trim() ? playerConflict(players, { name, nickname }) : null;

  const add = async () => {
    if (!name.trim() || conflict) return;
    try {
      await createPlayer(teamId, {
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        genderMatch,
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
        <p className="text-sm text-muted">No players yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {sortRoster(players).map((p) => (
            <li
              key={p.id}
              className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-[13px] ${
                p.genderMatch === "MMP" ? "border-sky-200 dark:border-sky-500/30" : "border-rose-200 dark:border-rose-500/30"
              }`}
            >
              <button
                onClick={() => setEditing(p)}
                className="flex min-w-0 flex-1 items-center gap-1 text-left hover:opacity-80"
              >
                <span
                  className={`shrink-0 ${
                    p.genderMatch === "MMP" ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {p.genderMatch}
                </span>
                <span className="min-w-0 flex-1 truncate">{displayName(p)}</span>
                <span className="shrink-0 text-[10px] text-faint">{roleTag(p.role)}</span>
                <span className="shrink-0 text-[10px] text-faint">{odTag(p.odPreference)}</span>
              </button>
              <button
                onClick={() => {
                  deletePlayer(p.id)
                    .then(onChange)
                    .catch((err) =>
                      setError(err instanceof Error ? err.message : String(err)),
                    );
                }}
                aria-label={`Remove ${p.name}`}
                className="shrink-0 text-faint hover:text-red-600 dark:text-red-400"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
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
        <select
          value={genderMatch}
          onChange={(e) => setGenderMatch(e.target.value as GenderMatch)}
          className="h-9 rounded border border-line-strong px-2"
        >
          <option value="MMP">MMP</option>
          <option value="WMP">WMP</option>
        </select>
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
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}
    </div>
  );
}

// ── Edit player modal ────────────────────────────────────────────────────────────

function EditPlayerModal({
  players,
  player,
  onClose,
  onSaved,
}: {
  players: Player[];
  player: Player;
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

  const conflict = name.trim()
    ? playerConflict(players, { name, nickname }, player.id)
    : "Name is required.";

  const save = async () => {
    if (conflict) return;
    const patch: Partial<PlayerInput> = {
      name: name.trim(),
      nickname: nickname.trim() || undefined,
      genderMatch,
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
  onCreate: (name: string, date: string) => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-3">
      <h2 className="font-medium">Tournaments</h2>
      {tournaments.length === 0 ? (
        <p className="text-sm text-muted">No tournaments yet.</p>
      ) : (
        <ul className="space-y-2">
          {tournaments.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tournaments/${t.id}`}
                className="flex items-center justify-between rounded-lg border border-line px-4 py-3 hover:bg-surface-2"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-faint">{t.startDate}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 rounded-lg border border-dashed border-line-strong p-3 text-sm">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tournament name"
          className="h-9 min-w-[8rem] flex-1 rounded border border-line-strong px-2"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded border border-line-strong px-2"
        />
        <button
          onClick={() => {
            if (!name.trim()) return;
            onCreate(name.trim(), date);
            setName("");
          }}
          disabled={!name.trim()}
          className="h-9 rounded bg-emerald-600 px-3 font-medium text-white disabled:bg-disabled"
        >
          Create
        </button>
      </div>
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
}: {
  games: Game[];
  emptyLabel: string;
}) {
  if (games.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2">
      {games.map((g) => (
        <li key={g.id}>
          <Link
            href={`/games/${g.id}`}
            className="flex items-center justify-between rounded-lg border border-line px-4 py-3 hover:bg-surface-2"
          >
            <span className="font-medium">vs {g.opponentName}</span>
            <span className="text-xs text-faint">
              {statusLabel[g.status]} · cap {g.gameCap}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
