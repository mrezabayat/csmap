/**
 * Fog of War — derive locked/unlocked state for a path's topics from the user's
 * completed set (gamification plan G3, §3.1).
 *
 * Pure and dependency-free so it runs in the React island (and later over a
 * localStorage event log for anonymous users) without pulling in `astro:content`.
 *
 * ## Why sequential, not purely prerequisite-based
 *
 * The plan's first cut locked a topic on its `prerequisites`. Empirically that
 * is inert: a scan of all 25 paths found **zero** in-path prerequisite chains —
 * paths point their prerequisites at foundational topics that live *outside* the
 * path. So prerequisite-only fog would never show a single lock.
 *
 * A learning path is fundamentally an *ordered roadmap*, so the natural unlock
 * is sequential: a topic stays fogged until the **previous required topic** is
 * complete, revealing the map one step at a time. We still honour any in-path
 * prerequisite (belt-and-braces for a future path that has real chains), but the
 * sequential gate is what makes the mechanic visible today.
 *
 * Scoping rule: only in-path prerequisites and in-path predecessors gate a
 * topic, so every lock is always satisfiable from the same screen.
 */

export interface FogTopic {
  id: string;
  /** The topic's prerequisite ids (out-of-path ids are filtered out here). */
  prerequisites: string[];
  /** Optional topics don't advance the sequential gate (they're side quests). */
  optional?: boolean;
}

export interface FogState {
  /** True when at least one in-path blocker is not yet completed. */
  locked: boolean;
  /**
   * The outstanding blockers (ids), in roadmap order: any incomplete in-path
   * prerequisites followed by the immediately-preceding required topic. Drives
   * the "complete X first" hint.
   */
  missing: string[];
}

/**
 * Map each ordered topic to its fog state. Single pass over the roadmap; O(n)
 * plus the prerequisite scan, well within the island's budget.
 *
 * `topics` MUST be in roadmap order — the sequential gate walks it in place.
 */
export function computeFog(
  topics: FogTopic[],
  completed: ReadonlySet<string>,
): Map<string, FogState> {
  const inPath = new Set(topics.map((t) => t.id));
  const result = new Map<string, FogState>();

  // The most recent *required* topic seen so far; the next topic unlocks once
  // it's complete. Null until the first required topic, so the head of the path
  // is never gated.
  let prevRequired: string | null = null;

  for (const topic of topics) {
    const missing: string[] = [];

    for (const p of topic.prerequisites) {
      if (inPath.has(p) && !completed.has(p)) missing.push(p);
    }

    if (
      prevRequired &&
      prevRequired !== topic.id &&
      !completed.has(prevRequired) &&
      !missing.includes(prevRequired)
    ) {
      missing.push(prevRequired);
    }

    result.set(topic.id, { locked: missing.length > 0, missing });

    if (!topic.optional) prevRequired = topic.id;
  }

  return result;
}
