import type { APIRoute } from "astro";
import { getCloudflareEnv, type CloudflareEnv } from "~/lib/cloudflare";
import { getAllTopics, topicUrl } from "~/lib/graph";
import { escapeHtml } from "~/lib/newsletter";
import { authorizeAdmin, sendCampaignToConfirmed } from "~/lib/newsletter-send";
import { checkRateLimit } from "~/lib/rate-limit";
import { SITE } from "~/site.config";

export const prerender = false;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_DELAY_MS = 500;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// On the very first run (no watermark yet), only look back this far so we don't
// email the entire back catalogue of topics.
const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// Keep the email readable even on a busy week.
const MAX_ITEMS = 25;

const META_KEY = "last_digest_at";
const siteOrigin = new URL(SITE.url).origin;

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

async function readWatermark(env: CloudflareEnv): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT value FROM newsletter_meta WHERE key = ?1`,
  )
    .bind(META_KEY)
    .first<{ value: string }>();
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

async function writeWatermark(env: CloudflareEnv, value: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO newsletter_meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(META_KEY, String(value))
    .run();
}

interface DigestItem {
  title: string;
  summary: string;
  url: string;
}

function buildDigestBody(items: DigestItem[]): {
  subject: string;
  bodyHtml: string;
  bodyText: string;
} {
  const count = items.length;
  const noun = count === 1 ? "topic" : "topics";
  const subject = `${SITE.name}: ${count} new ${noun}`;

  const itemsHtml = items
    .map(
      (it) => `
        <li style="margin:0 0 16px">
          <a href="${it.url}" style="font-size:16px;font-weight:600;color:#2563eb;text-decoration:none">
            ${escapeHtml(it.title)}
          </a>
          <p style="margin:4px 0 0;color:#374151;line-height:1.5">${escapeHtml(it.summary)}</p>
        </li>`,
    )
    .join("");

  const bodyHtml = `
    <h1 style="font-size:20px;margin:0 0 4px">What's new on ${escapeHtml(SITE.name)}</h1>
    <p style="color:#6b7280;margin:0 0 20px">${count} new ${noun} since the last issue.</p>
    <ul style="list-style:none;padding:0;margin:0">${itemsHtml}</ul>
    <p style="margin:24px 0 0">
      <a href="${siteOrigin}" style="color:#2563eb">Browse all topics &rarr;</a>
    </p>`;

  const bodyText = `What's new on ${SITE.name}\n\n${count} new ${noun} since the last issue.\n\n${items
    .map((it) => `• ${it.title}\n  ${it.summary}\n  ${it.url}`)
    .join("\n\n")}\n\nBrowse all topics: ${siteOrigin}`;

  return { subject, bodyHtml, bodyText };
}

export const POST: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);

  if (!env.NEWSLETTER_ADMIN_SECRET && !env.NEWSLETTER_ADMIN_EMAILS) {
    return json({ error: "Newsletter sending is not configured." }, 503);
  }
  if (!env.RESEND_API_KEY || !env.NEWSLETTER_FROM) {
    return json({ error: "Newsletter is not configured." }, 503);
  }

  const ip = context.clientAddress;
  const rl = await checkRateLimit(env, `nl-digest:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return json({ error: "Too many requests." }, 429, {
      "retry-after": String(rl.retryAfter),
    });
  }

  if (!(await authorizeAdmin(context.request, env, ip))) {
    await delay(AUTH_FAIL_DELAY_MS);
    return json({ error: "Unauthorized" }, 401);
  }

  // Optional ?dry=1 to preview which topics would be sent without sending.
  const dryRun = context.url.searchParams.get("dry") === "1";

  const runStart = Date.now();
  let watermark: number | null;
  try {
    watermark = await readWatermark(env);
  } catch {
    return json({ error: "Failed to read digest state." }, 500);
  }
  const since = watermark ?? runStart - FIRST_RUN_LOOKBACK_MS;

  // Half-open window (since, runStart] guarantees no topic is ever sent twice.
  const topics = await getAllTopics();
  const fresh = topics
    .filter((t) => {
      const u = t.data.updated.getTime();
      return u > since && u <= runStart;
    })
    .sort((a, b) => b.data.updated.getTime() - a.data.updated.getTime())
    .slice(0, MAX_ITEMS);

  if (fresh.length === 0) {
    // Nothing new: don't advance the watermark, just report.
    return json({ ok: true, sent: 0, reason: "no new topics", since });
  }

  const items: DigestItem[] = fresh.map((t) => ({
    title: t.data.title,
    summary: t.data.summary,
    url: `${siteOrigin}${topicUrl(t.id)}`,
  }));
  const content = buildDigestBody(items);

  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      wouldSend: items.length,
      subject: content.subject,
      topics: items.map((i) => i.title),
    });
  }

  let summary;
  try {
    summary = await sendCampaignToConfirmed(env, content);
  } catch {
    return json({ error: "Failed to send digest." }, 500);
  }

  // Advance the watermark only after a real send so failures can be retried.
  try {
    await writeWatermark(env, runStart);
  } catch {
    // Sent already; surface but don't fail the whole run.
    return json({ ok: true, ...summary, warning: "watermark not updated" });
  }

  return json({ ok: true, ...summary, items: items.length });
};
