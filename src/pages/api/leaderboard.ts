import type { APIRoute } from "astro";
import { getCloudflareEnv } from "~/lib/cloudflare";
import { loadGraph } from "~/lib/graph";

export const prerender = false;

const CACHE_KEY = "agg:topic-leaderboard:v1";
const TTL_SECONDS = 900; // 15 min — read-hot, eventual consistency is fine.
const TOP_N = 10;

export interface LeaderboardTopic {
  topicId: string;
  title: string;
  /** Distinct learners who have completed this topic. */
  learners: number;
}

export interface LeaderboardResponse {
  topics: LeaderboardTopic[];
  /** ISO time the aggregate was computed, or null when served live (no cache). */
  cachedAt: string | null;
}

function json(data: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
  };
  if (cacheSeconds > 0) {
    headers["cache-control"] = `public, max-age=${cacheSeconds}`;
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export const GET: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);
  const kv = env.LEADERBOARD_KV;

  // Fast path: a precomputed snapshot in KV (sub-ms read at the edge).
  if (kv) {
    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=${TTL_SECONDS}`,
        },
      });
    }
  }

  // Miss (or no KV binding): aggregate once over D1. COUNT(DISTINCT user_id)
  // so a topic completed in several paths counts the learner once.
  let rows: Array<{ topic_id: string; learners: number }>;
  try {
    const result = await env.DB.prepare(
      `SELECT topic_id, COUNT(DISTINCT user_id) AS learners
       FROM learning_progress
       GROUP BY topic_id
       ORDER BY learners DESC, topic_id ASC
       LIMIT ?1`,
    )
      .bind(TOP_N)
      .all<{ topic_id: string; learners: number }>();
    rows = result.results;
  } catch {
    return json({ topics: [], cachedAt: null } satisfies LeaderboardResponse, 200);
  }

  const { topicsById } = await loadGraph();
  const topics: LeaderboardTopic[] = rows.map((r) => ({
    topicId: r.topic_id,
    title: topicsById.get(r.topic_id)?.data.title ?? r.topic_id,
    learners: r.learners,
  }));

  const payload: LeaderboardResponse = {
    topics,
    cachedAt: new Date().toISOString(),
  };

  // Write the snapshot back without blocking the response.
  if (kv) {
    const write = kv.put(CACHE_KEY, JSON.stringify(payload), {
      expirationTtl: TTL_SECONDS,
    });
    context.locals.runtime?.ctx?.waitUntil?.(write);
  }

  return json(payload, 200, TTL_SECONDS);
};
