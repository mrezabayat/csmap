import type { APIRoute } from "astro";
import { createAuth } from "~/lib/auth";
import { getCloudflareEnv, type CloudflareEnv } from "~/lib/cloudflare";
import {
  getProgressPathSpec,
  isValidProgressTarget,
} from "~/lib/path-progress";

export const prerender = false;

const MAX_ID_LENGTH = 120;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
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
) {
  const headers = new Headers(request.headers);
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", clientAddress);
  }

  const session = await createAuth(env).api.getSession({
    headers,
  });
  return session?.user?.id ?? null;
}

export const GET: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);
  const pathId = context.url.searchParams.get("pathId");
  if (!isSafeId(pathId)) return json({ error: "Invalid pathId" }, 400);

  const spec = await getProgressPathSpec(pathId);
  if (!spec) return json({ error: "Invalid pathId" }, 400);

  const userId = await getSessionUserId(
    context.request,
    env,
    context.clientAddress,
  );
  if (!userId) return json({ error: "Unauthorized" }, 401);

  try {
    const { results } = await env.DB.prepare(
      `SELECT topic_id FROM learning_progress WHERE user_id = ?1 AND path_id = ?2`,
    )
      .bind(userId, pathId)
      .all<{ topic_id: string }>();

    const allowedTopics = new Set(spec.topicIds);
    const completedTopicIds = results
      .map((row) => row.topic_id)
      .filter((topicId) => allowedTopics.has(topicId));

    return json({ pathId, completedTopicIds });
  } catch {
    return json({ error: "Failed to load progress" }, 500);
  }
};

export const PUT: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid pathId or topicId" }, 400);
  }

  const { pathId, topicId, completed } = body as {
    pathId?: unknown;
    topicId?: unknown;
    completed?: unknown;
  };

  if (
    !isSafeId(pathId) ||
    !isSafeId(topicId) ||
    typeof completed !== "boolean" ||
    !(await isValidProgressTarget(pathId, topicId))
  ) {
    return json({ error: "Invalid pathId or topicId" }, 400);
  }

  const userId = await getSessionUserId(
    context.request,
    env,
    context.clientAddress,
  );
  if (!userId) return json({ error: "Unauthorized" }, 401);

  try {
    if (completed) {
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO learning_progress (user_id, path_id, topic_id, completed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(user_id, path_id, topic_id)
         DO UPDATE SET completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
      )
        .bind(userId, pathId, topicId, now)
        .run();
    } else {
      await env.DB.prepare(
        `DELETE FROM learning_progress WHERE user_id = ?1 AND path_id = ?2 AND topic_id = ?3`,
      )
        .bind(userId, pathId, topicId)
        .run();
    }
  } catch {
    return json({ error: "Failed to save progress" }, 500);
  }

  return json({ ok: true, pathId, topicId, completed });
};
