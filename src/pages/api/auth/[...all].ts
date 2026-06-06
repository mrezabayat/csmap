import type { APIRoute } from "astro";
import { createAuth } from "~/lib/auth";
import { getCloudflareEnv } from "~/lib/cloudflare";

export const prerender = false;

export const ALL: APIRoute = async (context) => {
  const auth = createAuth(getCloudflareEnv(context));
  const headers = new Headers(context.request.headers);
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", context.clientAddress);
  }

  return auth.handler(
    new Request(context.request, {
      headers,
    }),
  );
};
