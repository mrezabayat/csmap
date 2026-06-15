/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

type CloudflareBindings = {
  DB: D1Database;
  // Gamification G6 — leaderboard aggregate cache. Optional so code degrades
  // gracefully (recompute from D1) when the namespace isn't provisioned.
  LEADERBOARD_KV?: KVNamespace;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

declare namespace App {
  interface Locals {
    runtime?: import("@astrojs/cloudflare").Runtime<CloudflareBindings>["runtime"];
  }
}
