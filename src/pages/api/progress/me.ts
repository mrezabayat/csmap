import type { APIRoute } from "astro";
import { createAuth } from "~/lib/auth";
import {
  BADGE_DEFS,
  evaluateBadge,
  ringScholarDef,
  type Badge,
} from "~/lib/badges";
import { getCloudflareEnv, type CloudflareEnv } from "~/lib/cloudflare";
import {
  computeStreak,
  computeXp,
  dayIndex,
  rankProgress,
  type RankProgress,
} from "~/lib/gamification";
import { loadGraph } from "~/lib/graph";
import { normalisePathTopics } from "~/lib/paths";

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function getSessionUserId(
  request: Request,
  env: CloudflareEnv,
  clientAddress: string,
): Promise<string | null> {
  const headers = new Headers(request.headers);
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", clientAddress);
  }
  const session = await createAuth(env).api.getSession({ headers });
  return session?.user?.id ?? null;
}

export interface ProgressMePathSummary {
  pathId: string;
  pathTitle: string;
  completedTopicIds: string[];
  /** Completed required topics; counts toward percent. */
  completedCount: number;
  /** Total required topics (excludes optional). */
  requiredCount: number;
  /** 0..100, integer, computed from required topics only. */
  percent: number;
  /** ISO timestamp of the most recent toggle in this path, or null if untouched. */
  lastProgressedAt: string | null;
  /** First uncompleted required topic in this path, or null if done. */
  nextTopicId: string | null;
}

export interface ProgressMeRecent {
  pathId: string;
  pathTitle: string;
  topicId: string;
  topicTitle: string;
  completedAt: string;
}

export interface ProgressActivity {
  /** Consecutive-day study streak ending today or yesterday. */
  streakCurrent: number;
  /** Longest daily streak on record. */
  streakLongest: number;
  /**
   * Non-empty days only, as `[utcDayIndex, distinctTopicCount]`. Sparse on
   * purpose — the client fills the rest of the grid with zeros — so the payload
   * stays tiny regardless of how long the account has been active.
   */
  days: Array<[day: number, count: number]>;
}

export interface ProgressMeResponse {
  paths: ProgressMePathSummary[];
  recentTopics: ProgressMeRecent[];
  /** Derived XP + rank over all distinct completed topics (gamification G1). */
  rank: RankProgress;
  /** Derived daily streak + activity histogram (gamification G2). */
  activity: ProgressActivity;
  /** Topics the user has mastered via a checkpoint quiz (gamification G4). */
  masteredCount: number;
  /** Derived milestone badges (gamification G5). */
  badges: Badge[];
}

export const GET: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);
  const userId = await getSessionUserId(
    context.request,
    env,
    context.clientAddress,
  );
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let rows: Array<{ path_id: string; topic_id: string; completed_at: number }>;
  try {
    const result = await env.DB.prepare(
      `SELECT path_id, topic_id, completed_at
       FROM learning_progress
       WHERE user_id = ?1`,
    )
      .bind(userId)
      .all<{ path_id: string; topic_id: string; completed_at: number }>();
    rows = result.results;
  } catch {
    return json({ error: "Failed to load progress" }, 500);
  }

  const { paths, topicsById } = await loadGraph();

  // Group raw rows by path id.
  const byPath = new Map<
    string,
    Array<{ topicId: string; completedAt: number }>
  >();
  for (const row of rows) {
    const list = byPath.get(row.path_id) ?? [];
    list.push({ topicId: row.topic_id, completedAt: row.completed_at });
    byPath.set(row.path_id, list);
  }

  const summaries: ProgressMePathSummary[] = [];
  for (const [pathId, entries] of byPath) {
    const path = paths.find((p) => p.id === pathId);
    if (!path) continue; // Orphaned progress for a removed path; ignore.

    const normalised = normalisePathTopics(path.data.topics);
    const requiredIds = normalised
      .filter((n) => !n.optional)
      .map((n) => n.id);
    const requiredCount = requiredIds.length;
    const requiredSet = new Set(requiredIds);

    // Filter to topics still in the path; drop any stale ones the schema removed.
    const allowedIds = new Set(normalised.map((n) => n.id));
    const completedTopicIds = entries
      .map((e) => e.topicId)
      .filter((id) => allowedIds.has(id));
    const completedRequired = completedTopicIds.filter((id) =>
      requiredSet.has(id),
    );
    const completedCount = completedRequired.length;

    const percent =
      requiredCount === 0
        ? 0
        : Math.round((completedCount / requiredCount) * 100);

    // First required topic not yet completed.
    const completedRequiredSet = new Set(completedRequired);
    const nextTopicId =
      requiredIds.find((id) => !completedRequiredSet.has(id)) ?? null;

    const lastProgressedAt = entries.length
      ? new Date(Math.max(...entries.map((e) => e.completedAt))).toISOString()
      : null;

    summaries.push({
      pathId,
      pathTitle: path.data.title,
      completedTopicIds,
      completedCount,
      requiredCount,
      percent,
      lastProgressedAt,
      nextTopicId,
    });
  }

  // Most recent 20 toggle events, with topic + path titles inlined.
  const recentTopics: ProgressMeRecent[] = rows
    .slice()
    .sort((a, b) => b.completed_at - a.completed_at)
    .slice(0, 20)
    .map((row) => {
      const topic = topicsById.get(row.topic_id);
      const path = paths.find((p) => p.id === row.path_id);
      return {
        pathId: row.path_id,
        pathTitle: path?.data.title ?? row.path_id,
        topicId: row.topic_id,
        topicTitle: topic?.data.title ?? row.topic_id,
        completedAt: new Date(row.completed_at).toISOString(),
      };
    });

  // Sort paths by recency descending so "Continue learning" picks paths[0] cheaply.
  summaries.sort((a, b) => {
    const at = a.lastProgressedAt ? Date.parse(a.lastProgressedAt) : 0;
    const bt = b.lastProgressedAt ? Date.parse(b.lastProgressedAt) : 0;
    return bt - at;
  });

  // Mastered topics (passed the topic's quiz). Failure to read mastery must not
  // break the dashboard, so fall back to none.
  let masteredIds = new Set<string>();
  try {
    const masteredResult = await env.DB.prepare(
      `SELECT topic_id FROM topic_mastery WHERE user_id = ?1`,
    )
      .bind(userId)
      .all<{ topic_id: string }>();
    masteredIds = new Set(masteredResult.results.map((r) => r.topic_id));
  } catch {
    masteredIds = new Set();
  }

  const xpLookup = (id: string) => {
    const topic = topicsById.get(id);
    return topic
      ? { importance: topic.data.importance, level: topic.data.level }
      : undefined;
  };

  // XP counts each topic once, even if completed in several paths. Mastery is a
  // premium tier (G4 two-tier model): it adds the topic's XP again on top of the
  // completion XP.
  const distinctCompleted = new Set(rows.map((row) => row.topic_id));
  const xp = computeXp(distinctCompleted, xpLookup) + computeXp(masteredIds, xpLookup);
  const rank = rankProgress(xp);

  // Bucket completions by UTC day, counting distinct topics so the same topic
  // completed in two paths on one day is a single contribution, not two.
  const topicsByDay = new Map<number, Set<string>>();
  for (const row of rows) {
    const day = dayIndex(row.completed_at);
    let set = topicsByDay.get(day);
    if (!set) {
      set = new Set();
      topicsByDay.set(day, set);
    }
    set.add(row.topic_id);
  }
  const days: Array<[number, number]> = [...topicsByDay.entries()]
    .map(([day, set]): [number, number] => [day, set.size])
    .sort((a, b) => a[0] - b[0]);
  const streak = computeStreak(topicsByDay.keys(), dayIndex(Date.now()));

  const activity: ProgressActivity = {
    streakCurrent: streak.current,
    streakLongest: streak.longest,
    days,
  };

  // Badge inputs derived from the content graph (static) intersected with the
  // user's completions. One pass over all topics.
  const categoryTotal = new Map<string, number>();
  const categoryDone = new Map<string, number>();
  let totalCore = 0;
  let completedCore = 0;
  for (const [id, topic] of topicsById) {
    const cat = topic.data.category;
    categoryTotal.set(cat, (categoryTotal.get(cat) ?? 0) + 1);
    const done = distinctCompleted.has(id);
    if (done) categoryDone.set(cat, (categoryDone.get(cat) ?? 0) + 1);
    if (topic.data.importance === "core") {
      totalCore++;
      if (done) completedCore++;
    }
  }
  let categoriesComplete = 0;
  for (const [cat, total] of categoryTotal) {
    if (total > 0 && (categoryDone.get(cat) ?? 0) === total) categoriesComplete++;
  }
  const pathsComplete = summaries.filter(
    (s) => s.requiredCount > 0 && s.completedCount >= s.requiredCount,
  ).length;

  const badgeValues: Record<string, number> = {
    explorer: distinctCompleted.size,
    scholar: masteredIds.size,
    streak: streak.longest,
    cartographer: categoriesComplete,
    trailblazer: pathsComplete,
  };
  const badges: Badge[] = BADGE_DEFS.map((def) =>
    evaluateBadge(def, badgeValues[def.id] ?? 0),
  );
  badges.push(evaluateBadge(ringScholarDef(totalCore), completedCore));

  return json({
    paths: summaries,
    recentTopics,
    rank,
    activity,
    masteredCount: masteredIds.size,
    badges,
  } satisfies ProgressMeResponse);
};
