import type { APIRoute } from "astro";
import { getCloudflareEnv } from "~/lib/cloudflare";
import { buildCampaignEmail, sendEmail } from "~/lib/email";
import type { SubscriberRow } from "~/lib/newsletter";

export const prerender = false;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Constant-time-ish comparison to avoid leaking the secret via timing. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const POST: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);

  if (!env.NEWSLETTER_ADMIN_SECRET) {
    return json({ error: "Newsletter sending is not configured." }, 503);
  }
  if (!env.RESEND_API_KEY || !env.NEWSLETTER_FROM) {
    return json({ error: "Newsletter is not configured." }, 503);
  }

  const auth = context.request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || !secretsMatch(provided, env.NEWSLETTER_ADMIN_SECRET)) {
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

  let subscribers: SubscriberRow[];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM newsletter_subscriber WHERE status = 'confirmed'`,
    ).all<SubscriberRow>();
    subscribers = results;
  } catch {
    return json({ error: "Failed to load subscribers." }, 500);
  }

  let sent = 0;
  const failed: string[] = [];
  for (const sub of subscribers) {
    const mail = buildCampaignEmail({ subject, bodyHtml, bodyText }, sub);
    const result = await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.NEWSLETTER_FROM,
      to: sub.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      unsubscribe: mail.unsubscribe,
    });
    if (result.ok) sent++;
    else failed.push(sub.email);
  }

  return json({ ok: true, recipients: subscribers.length, sent, failed });
};
