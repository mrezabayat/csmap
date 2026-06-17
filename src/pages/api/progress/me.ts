import type { APIRoute } from "astro";
import { createAuth } from "~/lib/auth";
import { getCloudflareEnv, type CloudflareEnv } from "~/lib/cloudflare";
import { getPathMeta, getTopicTitle } from "~/lib/progress-meta";

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

export interface ProgressMeResponse {
  paths: ProgressMePathSummary[];
  recentTopics: ProgressMeRecent[];
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
    const path = getPathMeta(pathId);
    if (!path) continue; // Orphaned progress for a removed path; ignore.

    const requiredIds = path.requiredTopicIds;
    const requiredCount = requiredIds.length;
    const requiredSet = new Set(requiredIds);

    // Filter to topics still in the path; drop any stale ones the schema removed.
    const allowedIds = new Set(path.topicIds);
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
      pathTitle: path.title,
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
      const path = getPathMeta(row.path_id);
      return {
        pathId: row.path_id,
        pathTitle: path?.title ?? row.path_id,
        topicId: row.topic_id,
        topicTitle: getTopicTitle(row.topic_id) ?? row.topic_id,
        completedAt: new Date(row.completed_at).toISOString(),
      };
    });

  // Sort paths by recency descending so "Continue learning" picks paths[0] cheaply.
  summaries.sort((a, b) => {
    const at = a.lastProgressedAt ? Date.parse(a.lastProgressedAt) : 0;
    const bt = b.lastProgressedAt ? Date.parse(b.lastProgressedAt) : 0;
    return bt - at;
  });

  return json({ paths: summaries, recentTopics } satisfies ProgressMeResponse);
};
