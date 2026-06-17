import type { APIRoute } from "astro";
import { getCloudflareEnv } from "~/lib/cloudflare";
import { checkRateLimit } from "~/lib/rate-limit";
import { authorizeAdmin, sendCampaignToConfirmed } from "~/lib/newsletter-send";

export const prerender = false;

// Allow a handful of admin actions, then throttle. Generous enough for real
// use, tight enough that the endpoint can't be hammered.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60 * 1000;
// Slow down credential guessing without affecting legitimate use.
const AUTH_FAIL_DELAY_MS = 500;

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const POST: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);

  if (!env.NEWSLETTER_ADMIN_SECRET && !env.NEWSLETTER_ADMIN_EMAILS) {
    return json({ error: "Newsletter sending is not configured." }, 503);
  }
  if (!env.RESEND_API_KEY || !env.NEWSLETTER_FROM) {
    return json({ error: "Newsletter is not configured." }, 503);
  }

  const ip = context.clientAddress;
  const rl = await checkRateLimit(env, `nl-send:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return json({ error: "Too many requests." }, 429, {
      "retry-after": String(rl.retryAfter),
    });
  }

  if (!(await authorizeAdmin(context.request, env, ip))) {
    await delay(AUTH_FAIL_DELAY_MS);
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { subject?: unknown; html?: unknown; text?: unknown };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyHtml = typeof body.html === "string" ? body.html : "";
  const bodyText = typeof body.text === "string" ? body.text : "";
  if (!subject || !bodyHtml || !bodyText) {
    return json({ error: "subject, html, and text are required." }, 400);
  }

  let summary;
  try {
    summary = await sendCampaignToConfirmed(env, { subject, bodyHtml, bodyText });
  } catch {
    return json({ error: "Failed to send." }, 500);
  }

  return json({ ok: true, ...summary });
};
