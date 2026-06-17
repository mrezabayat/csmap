import { createAuth } from "~/lib/auth";
import type { CloudflareEnv } from "~/lib/cloudflare";
import {
  buildCampaignEmail,
  sendEmail,
  type CampaignContent,
} from "~/lib/email";
import type { SubscriberRow } from "~/lib/newsletter";

/** Constant-time-ish comparison so we don't leak the secret via timing. */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Bearer-token auth against NEWSLETTER_ADMIN_SECRET. Used by automation (the
 * GitHub Actions digest cron) which has no login session.
 */
export function isBearerAuthorized(
  request: Request,
  env: CloudflareEnv,
): boolean {
  if (!env.NEWSLETTER_ADMIN_SECRET) return false;
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return provided.length > 0 && secretsMatch(provided, env.NEWSLETTER_ADMIN_SECRET);
}

/** Parsed, normalized admin email allowlist from NEWSLETTER_ADMIN_EMAILS. */
function adminEmails(env: CloudflareEnv): string[] {
  return (env.NEWSLETTER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Session auth via better-auth: true when the logged-in user's email is on the
 * NEWSLETTER_ADMIN_EMAILS allowlist. Used by the interactive admin console so
 * no secret is ever typed into or stored in the browser.
 */
export async function isAdminSession(
  request: Request,
  env: CloudflareEnv,
  clientAddress: string,
): Promise<boolean> {
  const allow = adminEmails(env);
  if (allow.length === 0) return false;

  const headers = new Headers(request.headers);
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", clientAddress);
  }
  const session = await createAuth(env).api.getSession({ headers });
  const email = session?.user?.email?.toLowerCase();
  return !!email && allow.includes(email);
}

/** Authorize an admin action via either a login session or the bearer secret. */
export async function authorizeAdmin(
  request: Request,
  env: CloudflareEnv,
  clientAddress: string,
): Promise<boolean> {
  if (isBearerAuthorized(request, env)) return true;
  return isAdminSession(request, env, clientAddress);
}

export interface SendSummary {
  recipients: number;
  sent: number;
  failed: string[];
}

/**
 * Send one campaign to every confirmed subscriber. Each recipient gets their
 * own unsubscribe link in the footer. Shared by the manual send + auto digest.
 */
export async function sendCampaignToConfirmed(
  env: CloudflareEnv,
  content: CampaignContent,
): Promise<SendSummary> {
  if (!env.RESEND_API_KEY || !env.NEWSLETTER_FROM) {
    throw new Error("Newsletter is not configured.");
  }

  const { results: subscribers } = await env.DB.prepare(
    `SELECT * FROM newsletter_subscriber WHERE status = 'confirmed'`,
  ).all<SubscriberRow>();

  let sent = 0;
  const failed: string[] = [];
  for (const sub of subscribers) {
    const mail = buildCampaignEmail(content, sub);
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

  return { recipients: subscribers.length, sent, failed };
}
