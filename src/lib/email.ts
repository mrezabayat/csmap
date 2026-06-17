import { SITE } from "~/site.config";
import {
  confirmUrl,
  escapeHtml,
  unsubscribeUrl,
  type SubscriberRow,
} from "~/lib/newsletter";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// CAN-SPAM requires a physical mailing address in every commercial email.
// TODO: replace with your real postal address before going live.
const MAILING_ADDRESS = "newsletter@mycodingdays.com";

interface SendEmailParams {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 one-click unsubscribe URL. */
  unsubscribe?: string;
}

interface SendResult {
  ok: boolean;
  status: number;
  error?: string;
}

/** Send a single email via the Resend REST API (no SDK; plain fetch). */
export async function sendEmail(params: SendEmailParams): Promise<SendResult> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${params.apiKey}`,
    "content-type": "application/json",
  };
  if (params.unsubscribe) {
    headers["List-Unsubscribe"] = `<${params.unsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: await res.text() };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

/** Shared footer markup with the required unsubscribe link + address. */
function footerHtml(unsubUrl: string): string {
  return `
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
    <p style="font-size:12px;color:#6b7280;line-height:1.5">
      You're receiving this because you subscribed at
      <a href="${SITE.url}">${escapeHtml(SITE.name)}</a>.<br />
      <a href="${unsubUrl}">Unsubscribe</a> &middot; ${escapeHtml(MAILING_ADDRESS)}
    </p>`;
}

function footerText(unsubUrl: string): string {
  return `\n\n—\nYou're receiving this because you subscribed at ${SITE.url}\nUnsubscribe: ${unsubUrl}\n${MAILING_ADDRESS}`;
}

/** Double opt-in confirmation email (sent on signup). */
export function buildConfirmationEmail(token: string): {
  subject: string;
  html: string;
  text: string;
} {
  const url = confirmUrl(token);
  const subject = `Confirm your ${SITE.name} subscription`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#111827">Confirm your subscription</h2>
      <p style="color:#374151;line-height:1.6">
        Thanks for signing up to the ${escapeHtml(SITE.name)} newsletter.
        Click below to confirm your email address — we won't send anything until you do.
      </p>
      <p style="margin:24px 0">
        <a href="${url}"
           style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">
          Confirm subscription
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">
        If the button doesn't work, paste this link into your browser:<br />
        <a href="${url}">${url}</a>
      </p>
      <p style="font-size:13px;color:#6b7280">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>`;
  const text = `Confirm your ${SITE.name} subscription\n\nThanks for signing up. Confirm your email address by visiting:\n${url}\n\nIf you didn't request this, ignore this email.`;
  return { subject, html, text };
}

export interface CampaignContent {
  subject: string;
  /** Body HTML (without footer); footer is appended per-recipient. */
  bodyHtml: string;
  /** Plain-text body (without footer). */
  bodyText: string;
}

/** Build a per-recipient campaign email (footer carries their unsub link). */
export function buildCampaignEmail(
  content: CampaignContent,
  subscriber: Pick<SubscriberRow, "token">,
): { subject: string; html: string; text: string; unsubscribe: string } {
  const unsub = unsubscribeUrl(subscriber.token);
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111827">
      ${content.bodyHtml}
      ${footerHtml(unsub)}
    </div>`;
  const text = `${content.bodyText}${footerText(unsub)}`;
  return { subject: content.subject, html, text, unsubscribe: unsub };
}
