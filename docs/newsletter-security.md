# Newsletter admin security

This documents how access to the newsletter admin tooling is protected and how
to lock it down further.

## How auth works now

There are two protected endpoints and one admin page:

| Surface | Used by | Auth |
| --- | --- | --- |
| `/admin/newsletter` (page) | you, in a browser | better-auth session; email must be on the allowlist |
| `POST /api/newsletter/send` | the admin page | login session **or** bearer secret |
| `POST /api/newsletter/digest` | the admin page **and** the weekly cron | login session **or** bearer secret |

- **Login session** — `NEWSLETTER_ADMIN_EMAILS` is a comma-separated allowlist.
  When you're signed in (GitHub/Google) with an allowlisted email, the admin
  page renders and its buttons work. No secret is typed in or stored in the
  browser.
- **Bearer secret** — `NEWSLETTER_ADMIN_SECRET` still authorizes the endpoints
  via an `Authorization: Bearer …` header. This exists because the GitHub
  Actions digest cron has no login session. Keep it long and random.

Additional hardening already in place:

- **Rate limiting** — 20 requests per 15 minutes per IP on both endpoints
  (D1-backed, see `migrations/0004_rate_limit.sql`). Returns `429` when tripped.
- **Failure delay** — failed auth waits ~500 ms before responding, slowing
  automated guessing.
- **Constant-time** secret comparison, so the secret can't be recovered via
  response timing.
- The admin page is `noindex` and excluded from the sitemap.

> The admin secret is ~50 random characters (~235 bits). Brute-forcing it over
> the network is not feasible; the measures above are defense-in-depth.

## Required configuration

Set these as production secrets (`wrangler secret put …`):

- `NEWSLETTER_ADMIN_EMAILS` — e.g. `you@example.com` (enables the admin page)
- `NEWSLETTER_ADMIN_SECRET` — long random string (enables the cron)
- plus `RESEND_API_KEY`, `NEWSLETTER_FROM`

And add `NEWSLETTER_ADMIN_SECRET` as a GitHub **repository secret** so the
weekly workflow can authenticate.

## Recommended: put `/admin/*` behind Cloudflare Access

Cloudflare Access (Zero Trust) requires an identity check **at the edge** before
a request ever reaches the site — the strongest, lowest-effort option. Free for
up to 50 users.

1. In the Cloudflare dashboard, go to **Zero Trust → Access → Applications →
   Add an application → Self-hosted**.
2. **Application domain:** `csmap.mycodingdays.com`, path `admin` (so it covers
   `/admin/*`).
3. **Identity provider:** add Google (or GitHub / one-time PIN email) under
   **Settings → Authentication** if you haven't.
4. **Policy:** Action *Allow*, rule *Emails* → your email address.
5. Save. Visiting `/admin/newsletter` now forces a login at the edge; the
   app-level session check still applies as a second layer.

### Important: don't put the API endpoints behind Access naively

The weekly cron calls `POST /api/newsletter/digest` with only the bearer secret
— it has no browser login, so an Access policy on `/api/*` would block it.

Options:

- **Simplest (recommended):** only protect `/admin/*` with Access. The endpoints
  stay protected by the session/secret check + rate limiting, which is already
  solid.
- **If you want Access on the endpoints too:** create an Access **service token**
  and send its `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers from the
  GitHub Action, and add a service-token rule to the policy.

## Rotating the admin secret

If the secret is ever exposed (e.g. leaked in a log):

1. Generate a new one: `openssl rand -hex 32`.
2. `wrangler secret put NEWSLETTER_ADMIN_SECRET` with the new value.
3. Update the `NEWSLETTER_ADMIN_SECRET` GitHub repository secret to match.

Rotating the secret immediately invalidates the old one everywhere.
