/**
 * Badges (gamification plan G5, §4) — derived milestones, never stored.
 *
 * Each badge is a *tiered family*: the user's value (topics read, categories
 * completed, …) is checked against ascending thresholds. A badge is a pure
 * function of that value, which is itself derived from the completion + mastery
 * data already loaded in `/api/progress/me`. No `badges` table, ever.
 *
 * Dependency-free so it runs server-side or in the island.
 */

export interface BadgeTier {
  /** Minimum value to reach this tier (>= 1, ascending across a def). */
  at: number;
  /** Display name; defaults to "<family> <roman(level)>". */
  name?: string;
}

export interface BadgeDef {
  id: string;
  family: string;
  /** Unit shown next to the count, e.g. "topics read". */
  unit: string;
  tiers: BadgeTier[];
}

export interface Badge {
  id: string;
  family: string;
  unit: string;
  value: number;
  earned: boolean;
  /** Name of the highest tier reached, or null if none. */
  tierName: string | null;
  /** Count of tiers reached, 0..tiers.length. */
  level: number;
  /** Threshold of the next tier, or null when maxed out. */
  nextAt: number | null;
  /** Progress toward the next tier, 0..100 (100 when maxed). */
  percent: number;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
function roman(level: number): string {
  return ROMAN[level - 1] ?? String(level);
}

/** Resolve a badge family + a user's value to its earned tier and progress. */
export function evaluateBadge(def: BadgeDef, value: number): Badge {
  let level = 0;
  for (const tier of def.tiers) {
    if (value >= tier.at) level++;
    else break;
  }

  const current = level > 0 ? def.tiers[level - 1] : null;
  const next = level < def.tiers.length ? def.tiers[level] : null;
  const tierName = current
    ? (current.name ?? `${def.family} ${roman(level)}`)
    : null;

  let percent = 100;
  if (next) {
    const floor = current ? current.at : 0;
    const band = next.at - floor;
    percent =
      band > 0
        ? Math.max(0, Math.min(100, Math.round(((value - floor) / band) * 100)))
        : 0;
  }

  return {
    id: def.id,
    family: def.family,
    unit: def.unit,
    value,
    earned: level > 0,
    tierName,
    level,
    nextAt: next ? next.at : null,
    percent,
  };
}

/** Fixed-threshold badge families (display order). */
export const BADGE_DEFS: readonly BadgeDef[] = [
  {
    id: "explorer",
    family: "Explorer",
    unit: "topics read",
    tiers: [{ at: 1 }, { at: 10 }, { at: 50 }, { at: 150 }],
  },
  {
    id: "scholar",
    family: "Scholar",
    unit: "topics mastered",
    tiers: [{ at: 1 }, { at: 10 }, { at: 25 }],
  },
  {
    id: "streak",
    family: "Streak Keeper",
    unit: "day streak",
    tiers: [{ at: 3 }, { at: 7 }, { at: 30 }],
  },
  {
    id: "cartographer",
    family: "Cartographer",
    unit: "categories completed",
    tiers: [{ at: 1 }, { at: 5 }, { at: 18 }],
  },
  {
    id: "trailblazer",
    family: "Trailblazer",
    unit: "paths completed",
    tiers: [{ at: 1 }, { at: 5 }, { at: 25 }],
  },
] as const;

/**
 * Ring 1 Scholar is a single-target badge whose threshold is the (dynamic)
 * total number of `importance: core` topics, so its def is built from that count
 * rather than hard-coded.
 */
export function ringScholarDef(totalCore: number): BadgeDef {
  return {
    id: "ring-1",
    family: "Ring 1 Scholar",
    unit: "core topics",
    tiers: [{ at: Math.max(1, totalCore), name: "Ring 1 Scholar" }],
  };
}
