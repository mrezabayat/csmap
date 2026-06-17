import { SITE } from "~/site.config";
import { escapeHtml } from "~/lib/newsletter";

interface ResultPageOptions {
  title: string;
  message: string;
  status?: number;
}

/**
 * Minimal standalone HTML response for confirm/unsubscribe landing pages.
 * These are served from API routes (no Astro layout), so the markup is
 * self-contained and theme-agnostic.
 */
export function resultPage({
  title,
  message,
  status = 200,
}: ResultPageOptions): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)} — ${escapeHtml(SITE.name)}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#f9fafb; color:#111827;
         display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px;
          padding:32px; max-width:440px; text-align:center; margin:16px; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { color:#374151; line-height:1.6; margin:0 0 20px; }
  a { color:#2563eb; text-decoration:none; }
  a:hover { text-decoration:underline; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="${SITE.url}">&larr; Back to ${escapeHtml(SITE.name)}</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
