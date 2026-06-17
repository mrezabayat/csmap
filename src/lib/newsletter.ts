import { SITE } from "~/site.config";

/** Subscriber lifecycle states stored in newsletter_subscriber.status. */
export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed";

export interface SubscriberRow {
  id: string;
  email: string;
  status: SubscriberStatus;
  token: string;
  created_at: number;
  confirmed_at: number | null;
  source: string | null;
}

const MAX_EMAIL_LENGTH = 254;
// Deliberately conservative: one address, no display name, no quoting.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate + normalize an email, or return null if it isn't usable. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

/** A url-safe random opaque token (confirm + unsubscribe links). */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** crypto.randomUUID is available in the Workers runtime. */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Escape a string for safe interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const siteOrigin = new URL(SITE.url).origin;

export function confirmUrl(token: string): string {
  return `${siteOrigin}/api/newsletter/confirm?token=${token}`;
}

export function unsubscribeUrl(token: string): string {
  return `${siteOrigin}/api/newsletter/unsubscribe?token=${token}`;
}
