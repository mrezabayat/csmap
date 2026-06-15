import type { APIRoute } from "astro";
import { createAuth } from "~/lib/auth";
import { getCloudflareEnv, type CloudflareEnv } from "~/lib/cloudflare";
import { loadGraph } from "~/lib/graph";

export const prerender = false;

const MAX_ID_LENGTH = 120;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isSafeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[a-z0-9][a-z0-9-]*$/.test(value)
  );
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

async function isRealTopic(topicId: string): Promise<boolean> {
  const { topicsById } = await loadGraph();
  return topicsById.has(topicId);
}

export const GET: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);
  const userId = await getSessionUserId(
    context.request,
    env,
    context.clientAddress,
  );
  if (!userId) return json({ error: "Unauthorized" }, 401);

  try {
    const { results } = await env.DB.prepare(
      `SELECT topic_id FROM topic_mastery WHERE user_id = ?1`,
    )
      .bind(userId)
      .all<{ topic_id: string }>();
    return json({ masteredTopicIds: results.map((r) => r.topic_id) });
  } catch {
    return json({ error: "Failed to load mastery" }, 500);
  }
};

export const POST: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid topicId" }, 400);
  }

  const { topicId } = body as { topicId?: unknown };
  if (!isSafeId(topicId) || !(await isRealTopic(topicId))) {
    return json({ error: "Invalid topicId" }, 400);
  }

  const userId = await getSessionUserId(
    context.request,
    env,
    context.clientAddress,
  );
  if (!userId) return json({ error: "Unauthorized" }, 401);

  // Pass is graded client-side (the quiz key ships with the page); the Worker
  // only records mastery. Earliest-wins: re-passing never advances the
  // timestamp, so authentic history and the future anon -> signed-in merge are
  // preserved. SQLite's 2-arg MIN() is a scalar minimum.
  try {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO topic_mastery (user_id, topic_id, mastered_at, updated_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT(user_id, topic_id)
       DO UPDATE SET
         mastered_at = MIN(topic_mastery.mastered_at, excluded.mastered_at),
         updated_at = excluded.updated_at`,
    )
      .bind(userId, topicId, now)
      .run();
  } catch {
    return json({ error: "Failed to save mastery" }, 500);
  }

  return json({ ok: true, topicId });
};
