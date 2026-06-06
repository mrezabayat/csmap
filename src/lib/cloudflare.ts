import type { APIContext } from "astro";

export type CloudflareEnv = CloudflareBindings;

export function getCloudflareEnv(context: APIContext): CloudflareEnv {
  const env = context.locals.runtime?.env;
  if (!env?.DB) {
    throw new Error("Cloudflare D1 binding DB is not available.");
  }
  return env as CloudflareEnv;
}
