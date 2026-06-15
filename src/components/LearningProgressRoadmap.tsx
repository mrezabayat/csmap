import { Fragment, useEffect, useMemo, useState } from "react";
import { computeFog } from "~/lib/fog";

interface RoadmapTopic {
  id: string;
  title: string;
  summary: string;
  /** Bare topic URL; the component appends ?path= itself. */
  href: string;
  /** Optional topics still appear in the roadmap but don't count toward completion. */
  optional?: boolean;
  /**
   * If set, render a section header BEFORE this topic. Sections are visual only —
   * each topic that begins a new section carries the section name; subsequent
   * topics in the same section leave this undefined.
   */
  section?: string;
  /** Prerequisite topic ids; Fog of War (G3) locks on the ones in this path. */
  prerequisites?: string[];
}

interface Props {
  pathId: string;
  topics: RoadmapTopic[];
}

function withPath(href: string, pathId: string): string {
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}path=${encodeURIComponent(pathId)}`;
}

type LoadState = "loading" | "ready" | "signed-out" | "error";

export default function LearningProgressRoadmap({ pathId, topics }: Props) {
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProgress() {
      setState("loading");
      setMessage("");

      try {
        const response = await fetch(
          `/api/progress?pathId=${encodeURIComponent(pathId)}`,
          { headers: { accept: "application/json" } },
        );

        if (cancelled) return;

        if (response.status === 401) {
          setState("signed-out");
          setCompleted(new Set());
          return;
        }

        if (!response.ok) {
          setState("error");
          setMessage("Progress is unavailable right now.");
          return;
        }

        const data = (await response.json()) as {
          completedTopicIds?: unknown;
        };

        const topicIds = Array.isArray(data.completedTopicIds)
          ? data.completedTopicIds.filter((id): id is string => typeof id === "string")
          : [];

        setCompleted(new Set(topicIds));
        setState("ready");
      } catch {
        if (!cancelled) {
          setState("error");
          setMessage("Progress is unavailable right now.");
        }
      }
    }

    void loadProgress();

    return () => {
      cancelled = true;
    };
  }, [pathId]);

  // Only required topics count toward "% complete". Completed optional topics
  // are tracked (so the box can be ticked) but excluded from the denominator
  // and the count.
  const requiredIds = useMemo(
    () => new Set(topics.filter((t) => !t.optional).map((t) => t.id)),
    [topics],
  );
  const completedRequiredCount = useMemo(
    () => [...completed].filter((id) => requiredIds.has(id)).length,
    [completed, requiredIds],
  );
  const requiredCount = requiredIds.size;
  const disabled = state !== "ready";

  // Fog of War: lock topics whose in-path prerequisites aren't done yet. Only
  // surfaced once real progress has loaded — a signed-out visitor sees the full
  // map, not a wall of locks.
  const fog = useMemo(
    () =>
      computeFog(
        topics.map((t) => ({
          id: t.id,
          prerequisites: t.prerequisites ?? [],
          optional: t.optional,
        })),
        completed,
      ),
    [topics, completed],
  );
  const titleById = useMemo(
    () => new Map(topics.map((t) => [t.id, t.title])),
    [topics],
  );
  const showFog = state === "ready";

  const statusText = useMemo(() => {
    if (state === "loading") return "Loading progress...";
    if (state === "signed-out") return "Sign in to save progress.";
    if (state === "error") return message;
    return `${completedRequiredCount} of ${requiredCount} complete`;
  }, [completedRequiredCount, message, requiredCount, state]);

  const toggleTopic = async (topicId: string, nextCompleted: boolean) => {
    if (disabled || saving.has(topicId)) return;

    const previous = new Set(completed);
    const optimistic = new Set(completed);
    if (nextCompleted) optimistic.add(topicId);
    else optimistic.delete(topicId);

    setCompleted(optimistic);
    setSaving((current) => new Set(current).add(topicId));
    setMessage("");

    try {
      const response = await fetch("/api/progress", {
        method: "PUT",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          pathId,
          topicId,
          completed: nextCompleted,
        }),
      });

      if (response.status === 401) {
        setCompleted(previous);
        setState("signed-out");
        return;
      }

      if (!response.ok) {
        setCompleted(previous);
        setMessage("Could not save progress.");
        return;
      }

      setState("ready");
    } catch {
      setCompleted(previous);
      setMessage("Could not save progress.");
    } finally {
      setSaving((current) => {
        const next = new Set(current);
        next.delete(topicId);
        return next;
      });
    }
  };

  return (
    <section className="mt-8" aria-label="Roadmap">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--color-atlas-ink)]">
          Roadmap
        </h2>
        <p className="text-sm text-[var(--color-atlas-muted)]" aria-live="polite">
          {statusText}
        </p>
      </div>
      <ol className="mt-3 space-y-2">
        {topics.map((topic, index) => {
          const isCompleted = completed.has(topic.id);
          const isSaving = saving.has(topic.id);
          const fogState = fog.get(topic.id);
          const isLocked = showFog && !isCompleted && Boolean(fogState?.locked);
          const missingTitles =
            fogState?.missing.map((id) => titleById.get(id) ?? id) ?? [];
          const isFirstOfNewSection =
            !!topic.section &&
            (index === 0 || topics[index - 1]?.section !== topic.section);

          return (
            <Fragment key={topic.id}>
              {isFirstOfNewSection && (
                <li
                  className="pt-3 first:pt-0"
                  aria-label={`Section: ${topic.section}`}
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
                    {topic.section}
                  </h3>
                </li>
              )}
              <li
                className={`flex items-start gap-3 rounded-lg border bg-[var(--color-atlas-surface)] p-3 transition-opacity ${
                  topic.optional
                    ? "border-dashed border-[var(--color-atlas-line)]"
                    : "border-[var(--color-atlas-line)]"
                } ${isLocked ? "opacity-60" : ""}`}
              >
                <span
                  className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isLocked
                      ? "bg-[var(--color-atlas-line)] text-[var(--color-atlas-muted)]"
                      : "bg-[var(--color-atlas-accent-soft)] text-[var(--color-atlas-accent)]"
                  }`}
                  aria-hidden="true"
                >
                  {isLocked ? "🔒" : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <a
                      href={withPath(topic.href, pathId)}
                      className="text-base font-semibold text-[var(--color-atlas-ink)] no-underline hover:underline"
                    >
                      {topic.title}
                    </a>
                    {topic.optional && (
                      <span
                        className="inline-flex items-center rounded-full border border-[var(--color-atlas-line)] bg-[var(--color-atlas-bg)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-atlas-muted)]"
                        title="Optional — doesn't count toward path completion."
                      >
                        Optional
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--color-atlas-muted)]">
                    {topic.summary}
                  </p>
                  {isLocked && missingTitles.length > 0 && (
                    <p className="mt-1 text-xs text-[var(--color-atlas-muted)]">
                      🔒 Complete first: {missingTitles.join(", ")}
                    </p>
                  )}
                </div>
                <label className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center">
                  <span className="sr-only">
                    {isCompleted ? "Mark incomplete" : "Mark complete"}:{" "}
                    {topic.title}
                  </span>
                  <input
                    type="checkbox"
                    checked={isCompleted}
                    disabled={disabled || isSaving}
                    onChange={(event) =>
                      toggleTopic(topic.id, event.currentTarget.checked)
                    }
                    className="h-5 w-5 rounded border-[var(--color-atlas-line)] accent-[var(--color-atlas-accent)] disabled:cursor-not-allowed"
                  />
                </label>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
