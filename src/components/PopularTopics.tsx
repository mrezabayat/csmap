import { useEffect, useState } from "react";
import type {
  LeaderboardResponse,
  LeaderboardTopic,
} from "~/pages/api/leaderboard";

type State =
  | { kind: "loading" }
  | { kind: "ready"; topics: LeaderboardTopic[] }
  | { kind: "error" };

export default function PopularTopics() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/leaderboard", {
          headers: { accept: "application/json" },
        });
        if (cancelled) return;
        if (!r.ok) {
          setState({ kind: "error" });
          return;
        }
        const data = (await r.json()) as LeaderboardResponse;
        setState({ kind: "ready", topics: data.topics });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stay quiet on error or an empty board — this is a "nice to have" widget and
  // shouldn't show a broken card when there's no community data yet.
  if (state.kind === "error") return null;
  if (state.kind === "ready" && state.topics.length === 0) return null;

  const max =
    state.kind === "ready"
      ? Math.max(1, ...state.topics.map((t) => t.learners))
      : 1;

  return (
    <section aria-label="Popular in the Atlas" className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
        Popular in the Atlas
      </h2>
      {state.kind === "loading" ? (
        <div className="mt-3 h-32 animate-pulse rounded-lg border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)]" />
      ) : (
        <ol className="mt-3 space-y-1.5">
          {state.topics.map((topic, i) => (
            <li
              key={topic.topicId}
              className="flex items-center gap-3 rounded-md border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] px-3 py-2"
            >
              <span
                className="w-5 shrink-0 text-right text-xs tabular-nums text-[var(--color-atlas-muted)]"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <a
                href={`/t/${topic.topicId}`}
                className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-atlas-ink)] no-underline hover:underline"
              >
                {topic.title}
              </a>
              <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-atlas-line)] sm:block">
                <div
                  className="h-full bg-[var(--color-atlas-accent)]"
                  style={{ width: `${Math.round((topic.learners / max) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-[var(--color-atlas-muted)]">
                {topic.learners.toLocaleString()}{" "}
                {topic.learners === 1 ? "learner" : "learners"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
