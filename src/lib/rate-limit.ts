import type { CloudflareEnv } from "~/lib/cloudflare";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (only meaningful when blocked). */
  retryAfter: number;
}

/**
 * Fixed-window rate limiter backed by D1. Each call counts as one hit against
 * `key` within the current window; once the count exceeds `limit`, further
 * calls in that window are rejected. Keep `key` specific (e.g. "scope:ip").
 *
 * Fails open: if the counter read/write errors, the request is allowed. We'd
 * rather not lock out legitimate admins because of a transient DB hiccup —
 * the shared secret / session check is still the primary gate.
 */
export async function checkRateLimit(
  env: CloudflareEnv,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  try {
    const row = await env.DB.prepare(
      `SELECT count, reset_at FROM rate_limit WHERE key = ?1`,
    )
      .bind(key)
      .first<{ count: number; reset_at: number }>();

    // New key, or the previous window has expired: start a fresh window.
    if (!row || now > row.reset_at) {
      const resetAt = now + windowMs;
      await env.DB.prepare(
        `INSERT INTO rate_limit (key, count, reset_at) VALUES (?1, 1, ?2)
         ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = ?2`,
      )
        .bind(key, resetAt)
        .run();
      return { allowed: true, retryAfter: 0 };
    }

    const count = row.count + 1;
    await env.DB.prepare(`UPDATE rate_limit SET count = ?2 WHERE key = ?1`)
      .bind(key, count)
      .run();

    if (count > limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((row.reset_at - now) / 1000)),
      };
    }
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}
