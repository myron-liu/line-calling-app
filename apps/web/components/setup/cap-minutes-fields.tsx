"use client";

/**
 * The three time caps, in minutes from the game's first confirmed line.
 *
 * Shared by the create-game form and the edit-game modal so the labels,
 * ordering and validation can't drift apart. Values are held as strings
 * because an empty input has to stay distinguishable from a zero — "no half
 * cap" and "half cap at minute 0" are very different things.
 */
export interface CapMinutesDraft {
  half: string;
  soft: string;
  hard: string;
}

export const emptyCapDraft = (): CapMinutesDraft => ({ half: "", soft: "", hard: "" });

export function capDraftFrom(game: {
  halfCapMinutes?: number;
  softCapMinutes?: number;
  hardCapMinutes?: number;
}): CapMinutesDraft {
  return {
    half: game.halfCapMinutes?.toString() ?? "",
    soft: game.softCapMinutes?.toString() ?? "",
    hard: game.hardCapMinutes?.toString() ?? "",
  };
}

/** Undefined for a blank field — the caller decides whether that means "leave
 *  alone" (create) or "clear it" (edit, which sends null instead). */
export function capValue(raw: string): number | undefined {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) || n <= 0 ? undefined : Math.round(n);
}

/**
 * Caps must run half ≤ soft ≤ hard to make any sense. Returns a message to
 * show, or null when the set is coherent (including when it's empty, or only
 * partly filled in — a game with just a hard cap is perfectly normal).
 */
export function capOrderError(draft: CapMinutesDraft): string | null {
  const half = capValue(draft.half);
  const soft = capValue(draft.soft);
  const hard = capValue(draft.hard);
  if (half !== undefined && soft !== undefined && soft < half) {
    return "Soft cap can’t come before half cap.";
  }
  if (soft !== undefined && hard !== undefined && hard < soft) {
    return "Hard cap can’t come before soft cap.";
  }
  if (half !== undefined && hard !== undefined && hard < half) {
    return "Hard cap can’t come before half cap.";
  }
  return null;
}

export function CapMinutesFields({
  draft,
  onChange,
}: {
  draft: CapMinutesDraft;
  onChange: (next: CapMinutesDraft) => void;
}) {
  const error = capOrderError(draft);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">
        Time caps
      </p>
      <p className="text-xs text-faint">
        Minutes from the first pull. Leave blank if there&rsquo;s no cap — you
        get a 15-minute warning before each one.
      </p>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <CapField
          label="Half"
          value={draft.half}
          onChange={(half) => onChange({ ...draft, half })}
        />
        <CapField
          label="Soft"
          value={draft.soft}
          onChange={(soft) => onChange({ ...draft, soft })}
        />
        <CapField
          label="Hard"
          value={draft.hard}
          onChange={(hard) => onChange({ ...draft, hard })}
        />
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function CapField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={1440}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="min"
        className="rounded border border-line-strong px-3 py-2"
      />
    </label>
  );
}
