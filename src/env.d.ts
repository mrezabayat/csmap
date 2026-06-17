/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type CloudflareBindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  // Resend API key for sending newsletter emails.
  RESEND_API_KEY?: string;
  // Verified "from" address, e.g. "CS Map <newsletter@yourdomain>".
  NEWSLETTER_FROM?: string;
  // Shared secret guarding the admin-only send endpoint.
  NEWSLETTER_ADMIN_SECRET?: string;
};

declare namespace App {
  interface Locals {
    runtime?: import("@astrojs/cloudflare").Runtime<CloudflareBindings>["runtime"];
  }
}
