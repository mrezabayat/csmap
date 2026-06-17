import type { APIRoute } from "astro";
import { getCloudflareEnv } from "~/lib/cloudflare";
import { resultPage } from "~/lib/newsletter-page";
import type { SubscriberRow } from "~/lib/newsletter";

export const prerender = false;

const TOKEN_RE = /^[a-f0-9]{64}$/;

export const GET: APIRoute = async (context) => {
  const env = getCloudflareEnv(context);
  const token = context.url.searchParams.get("token");

  if (!token || !TOKEN_RE.test(token)) {
    return resultPage({
      title: "Invalid link",
      message: "This confirmation link is invalid or has expired.",
      status: 400,
    });
  }

  let row: SubscriberRow | null;
  try {
    row = await env.DB.prepare(
      `SELECT * FROM newsletter_subscriber WHERE token = ?1`,
    )
      .bind(token)
      .first<SubscriberRow>();
  } catch {
    return resultPage({
      title: "Something went wrong",
      message: "Please try the link again in a moment.",
      status: 500,
    });
  }

  if (!row || row.status === "unsubscribed") {
    return resultPage({
      title: "Invalid link",
      message: "This confirmation link is invalid or has expired.",
      status: 400,
    });
  }

  if (row.status === "confirmed") {
    return resultPage({
      title: "You're already subscribed",
      message: "Your email is already confirmed. Thanks for reading!",
    });
  }

  try {
    await env.DB.prepare(
      `UPDATE newsletter_subscriber SET status = 'confirmed', confirmed_at = ?2 WHERE id = ?1`,
    )
      .bind(row.id, Date.now())
      .run();
  } catch {
    return resultPage({
      title: "Something went wrong",
      message: "Please try the link again in a moment.",
      status: 500,
    });
  }

  return resultPage({
    title: "You're subscribed! 🎉",
    message:
      "Thanks for confirming. You'll get an email when new topics are published.",
  });
};
