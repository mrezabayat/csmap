/**
 * Gamification derivations — XP and ranks.
 *
 * Design rule (docs/gamification-plan.md §1): *derive, don't store*. XP and rank
 * are pure functions of `(completed topics × the static content graph)`. Nothing
 * here is persisted; the same functions run server-side over D1 rows and (later)
 * client-side over a localStorage event log.
 *
 * Keep this module dependency-free so it can be imported from a React island or
 * the Worker without pulling in `astro:content`.
 */

export type Importance = "core" | "important" | "supplemental";
export type Level = "beginner" | "intermediate" | "advanced";

/** Base points per topic, weighted by how central it is to the Atlas. */
export const XP_BY_IMPORTANCE: Record<Importance, number> = {
  core: 30,
  important: 20,
  supplemental: 10,
};

/** Multiplier rewarding harder material. */
export const XP_BY_LEVEL: Record<Level, number> = {
  beginner: 1,
  intermediate: 1.5,
  advanced: 2,
};

/** XP awarded for completing a single topic. Integer by construction. */
export function topicXp(importance: Importance, level: Level): number {
  return Math.round(XP_BY_IMPORTANCE[importance] * XP_BY_LEVEL[level]);
}

/**
 * Total XP over a set of completed topics. The caller passes a lookup so this
 * stays decoupled from the content collection. Topics the lookup can't resolve
 * (stale ids) contribute nothing.
 *
 * Callers MUST pass *distinct* topic ids — the same topic completed in two
 * different paths is one achievement, not two. Use a Set at the call site.
 */
export function computeXp(
  topicIds: Iterable<string>,
  lookup: (id: string) => { importance: Importance; level: Level } | undefined,
): number {
  let xp = 0;
  for (const id of topicIds) {
    const meta = lookup(id);
    if (meta) xp += topicXp(meta.importance, meta.level);
  }
  return xp;
}

/** Milliseconds in a UTC day — the bucket size for streaks and the activity grid. */
export const MS_PER_DAY = 86_400_000;

/** UTC day index (days since the epoch) for a millisecond timestamp. */
export function dayIndex(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

export interface Streak {
  /** Length of the run ending today or yesterday; 0 if the latest day is older. */
  current: number;
  /** Longest consecutive-day run ever. */
  longest: number;
}

/**
 * Current and longest daily streaks from a set of active UTC day indices.
 *
 * `today` is passed in (not read from the clock) so the function stays pure and
 * testable. The current streak stays "alive" if the most recent activity was
 * today *or* yesterday — finishing yesterday and not yet today shouldn't read as
 * a broken streak until the day actually lapses.
 */
export function computeStreak(dayIndices: Iterable<number>, today: number): Streak {
  const days = [...new Set(dayIndices)].sort((a, b) => a - b);
  if (days.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const latest = days[days.length - 1];
  let current = 0;
  if (latest === today || latest === today - 1) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (days[i] === days[i - 1] + 1) current++;
      else break;
    }
  }

  return { current, longest };
}

export interface RankTier {
  /** Minimum XP to hold this rank. */
  min: number;
  name: string;
}

/** Ascending by `min`. The first tier (0) is the floor everyone starts at. */
export const RANKS: readonly RankTier[] = [
  { min: 0, name: "Script Kiddie" },
  { min: 300, name: "Junior Dev" },
  { min: 900, name: "Systems Thinker" },
  { min: 2000, name: "Architect" },
  { min: 4000, name: "Bare-Metal Wizard" },
] as const;

export interface RankProgress {
  xp: number;
  /** Current rank name. */
  name: string;
  /** XP floor of the current tier. */
  floor: number;
  /** Next tier's name, or null when maxed out. */
  nextName: string | null;
  /** XP at which the next tier unlocks, or null when maxed out. */
  nextAt: number | null;
  /** XP still needed to reach the next tier; 0 when maxed out. */
  toNext: number;
  /** Progress through the current band, 0..100. 100 when maxed out. */
  percentToNext: number;
}

/**
 * Resolve an XP total to its rank and progress toward the next one. Pure and
 * allocation-light — a single linear scan over the small RANKS table.
 */
export function rankProgress(xp: number): RankProgress {
  let current: RankTier = RANKS[0];
  let next: RankTier | null = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i].min) {
      current = RANKS[i];
      next = RANKS[i + 1] ?? null;
    } else {
      break;
    }
  }

  if (!next) {
    return {
      xp,
      name: current.name,
      floor: current.min,
      nextName: null,
      nextAt: null,
      toNext: 0,
      percentToNext: 100,
    };
  }

  const band = next.min - current.min;
  const into = xp - current.min;
  return {
    xp,
    name: current.name,
    floor: current.min,
    nextName: next.name,
    nextAt: next.min,
    toNext: next.min - xp,
    percentToNext: band > 0 ? Math.round((into / band) * 100) : 0,
  };
}
