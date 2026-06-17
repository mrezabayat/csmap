import type { APIRoute } from "astro";
import { getCloudflareEnv } from "~/lib/cloudflare";
import { buildConfirmationEmail, sendEmail } from "~/lib/email";
import {
  generateId,
  generateToken,
  normalizeEmail,
  type SubscriberRow,
} from "~/lib/newsletter";

export const prerender = false;

const MAX_SOURCE_LENGTH = 40;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);

  // Accept JSON (fetch) or form-encoded (no-JS fallback).
  let email: string | null = null;
  let source: string | null = null;
  const contentType = context.request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await context.request.json()) as Record<string, unknown>;
      email = normalizeEmail(body.email);
      source = typeof body.source === "string" ? body.source : null;
    } else {
      const form = await context.request.formData();
      email = normalizeEmail(form.get("email"));
      const s = form.get("source");
      source = typeof s === "string" ? s : null;
    }
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  if (!email) return json({ error: "Please enter a valid email address." }, 400);
  if (source && source.length > MAX_SOURCE_LENGTH) source = source.slice(0, MAX_SOURCE_LENGTH);

  if (!env.RESEND_API_KEY || !env.NEWSLETTER_FROM) {
    return json({ error: "Newsletter is not configured." }, 503);
  }

  let existing: SubscriberRow | null;
  try {
    existing = await env.DB.prepare(
      `SELECT * FROM newsletter_subscriber WHERE email = ?1`,
    )
      .bind(email)
      .first<SubscriberRow>();
  } catch {
    return json({ error: "Something went wrong. Please try again." }, 500);
  }

  // Already confirmed: succeed quietly, don't leak status or re-send.
  if (existing?.status === "confirmed") {
    return json({ ok: true, status: "already-subscribed" });
  }

  // Reuse the row for pending/unsubscribed, refreshing the token so old
  // links are invalidated; otherwise create a new pending subscriber.
  const token = generateToken();
  const now = Date.now();
  try {
    if (existing) {
      await env.DB.prepare(
        `UPDATE newsletter_subscriber
         SET status = 'pending', token = ?2, created_at = ?3, confirmed_at = NULL, source = ?4
         WHERE id = ?1`,
      )
        .bind(existing.id, token, now, source)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO newsletter_subscriber (id, email, status, token, created_at, source)
         VALUES (?1, ?2, 'pending', ?3, ?4, ?5)`,
      )
        .bind(generateId(), email, token, now, source)
        .run();
    }
  } catch {
    return json({ error: "Something went wrong. Please try again." }, 500);
  }

  const mail = buildConfirmationEmail(token);
  const result = await sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.NEWSLETTER_FROM,
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  if (!result.ok) {
    return json(
      { error: "We couldn't send the confirmation email. Please try again." },
      502,
    );
  }

  return json({ ok: true, status: "confirmation-sent" });
};
