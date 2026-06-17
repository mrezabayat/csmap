import type { APIRoute } from "astro";
import { getCloudflareEnv } from "~/lib/cloudflare";
import { resultPage } from "~/lib/newsletter-page";
import type { SubscriberRow } from "~/lib/newsletter";

export const prerender = false;

const TOKEN_RE = /^[a-f0-9]{64}$/;

/** Mark a subscriber unsubscribed by token. Shared by GET (link) + POST (one-click). */
async function unsubscribeByToken(
  env: ReturnType<typeof getCloudflareEnv>,
  token: string | null,
): Promise<"ok" | "invalid" | "error"> {
  if (!token || !TOKEN_RE.test(token)) return "invalid";

  let row: SubscriberRow | null;
  try {
    row = await env.DB.prepare(
      `SELECT * FROM newsletter_subscriber WHERE token = ?1`,
    )
      .bind(token)
      .first<SubscriberRow>();
  } catch {
    return "error";
  }
  if (!row) return "invalid";
  if (row.status === "unsubscribed") return "ok";

  try {
    await env.DB.prepare(
      `UPDATE newsletter_subscriber SET status = 'unsubscribed' WHERE id = ?1`,
    )
      .bind(row.id)
      .run();
  } catch {
    return "error";
  }
  return "ok";
}

export const GET: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);
  const outcome = await unsubscribeByToken(
    env,
    context.url.searchParams.get("token"),
  );

  if (outcome === "invalid") {
    return resultPage({
      title: "Invalid link",
      message: "This unsubscribe link is invalid.",
      status: 400,
    });
  }
  if (outcome === "error") {
    return resultPage({
      title: "Something went wrong",
      message: "Please try the link again in a moment.",
      status: 500,
    });
  }
  return resultPage({
    title: "You've been unsubscribed",
    message: "You won't receive any more emails. Sorry to see you go!",
  });
};

// RFC 8058 one-click unsubscribe: email clients POST here directly.
export const POST: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);
  let token = context.url.searchParams.get("token");
  if (!token) {
    try {
      const form = await context.request.formData();
      const t = form.get("token");
      if (typeof t === "string") token = t;
    } catch {
      // ignore; handled as invalid below
    }
  }
  const outcome = await unsubscribeByToken(env, token);
  const status = outcome === "ok" ? 200 : outcome === "invalid" ? 400 : 500;
  return new Response(null, { status });
};
