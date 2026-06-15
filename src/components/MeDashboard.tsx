import { useEffect, useState } from "react";
import type { Badge } from "~/lib/badges";
import {
  dayIndex,
  MS_PER_DAY,
  type RankProgress,
} from "~/lib/gamification";
import type { ProgressActivity } from "~/pages/api/progress/me";
import {
  getProgressMe,
  type ProgressMeState,
} from "~/lib/progress-client";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function continueHref(pathId: string, topicId: string): string {
  return `/t/${topicId}?path=${encodeURIComponent(pathId)}`;
}

export default function MeDashboard() {
  const [state, setState] = useState<ProgressMeState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    getProgressMe().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <div
        className="mt-8 h-32 animate-pulse rounded-lg border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)]"
        aria-label="Loading your progress"
      />
    );
  }

  if (state.kind === "signed-out") {
    return (
      <p className="mt-8 text-sm text-[var(--color-atlas-muted)]">
        You appear to be signed out. Refresh after signing in.
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <p
        className="mt-8 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        role="alert"
      >
        {state.message}
      </p>
    );
  }

  const { paths, recentTopics, rank, activity, masteredCount, badges } =
    state.data;
  const continueWith =
    paths.find((p) => p.lastProgressedAt && p.nextTopicId) ?? null;

  const inProgress = paths.filter(
    (p) => p.completedCount > 0 && p.completedCount < p.requiredCount,
  );
  const completed = paths.filter(
    (p) => p.requiredCount > 0 && p.completedCount >= p.requiredCount,
  );

  const totalTopicsRead = paths.reduce((sum, p) => sum + p.completedCount, 0);
  const distinctDays = new Set(
    recentTopics.map((r) => r.completedAt.slice(0, 10)),
  ).size;

  return (
    <div className="mt-6 space-y-10">
      {/* Rank */}
      <RankCard rank={rank} />

      {/* Continue learning */}
      {continueWith ? (
        <section aria-label="Continue learning">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
            Continue learning
          </h2>
          <div className="mt-3 rounded-lg border border-[var(--color-atlas-accent)]/40 bg-[var(--color-atlas-accent-soft)] p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-[var(--color-atlas-ink)]">
                {continueWith.pathTitle}
              </h3>
              <span className="text-xs text-[var(--color-atlas-muted)]">
                last activity {fmtRelative(continueWith.lastProgressedAt!)}
              </span>
            </div>
            <ProgressBar
              completedCount={continueWith.completedCount}
              requiredCount={continueWith.requiredCount}
              percent={continueWith.percent}
            />
            {continueWith.nextTopicId && (
              <a
                href={continueHref(
                  continueWith.pathId,
                  continueWith.nextTopicId,
                )}
                className="mt-4 inline-flex items-center gap-1 rounded-md bg-[var(--color-atlas-accent)] px-3 py-1.5 text-sm font-medium text-white no-underline"
              >
                Resume here
                <span aria-hidden="true">→</span>
              </a>
            )}
          </div>
        </section>
      ) : null}

      {/* Stats */}
      <section aria-label="Stats">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
          Stats
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 max-w-md text-sm text-[var(--color-atlas-muted)] sm:grid-cols-4">
          <Stat label="Topics read" value={totalTopicsRead} />
          <Stat label="Mastered" value={masteredCount} hint="quizzes" />
          <Stat label="Paths complete" value={completed.length} />
          <Stat label="Active days" value={distinctDays} hint="recent 20" />
        </dl>
      </section>

      {/* Activity */}
      <ActivityCard activity={activity} />

      {/* Badges */}
      <section aria-label="Badges">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
          Badges
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((badge) => (
            <BadgeCard key={badge.id} badge={badge} />
          ))}
        </ul>
      </section>

      {/* In progress */}
      <section aria-label="In progress">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
          In progress
        </h2>
        {inProgress.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-atlas-muted)]">
            No paths in progress.{" "}
            <a
              href="/paths"
              className="text-[var(--color-atlas-accent)] no-underline hover:underline"
            >
              Pick one to start
            </a>
            .
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {inProgress.map((p) => (
              <li
                key={p.pathId}
                className="rounded-lg border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={`/p/${p.pathId}`}
                    className="text-base font-semibold text-[var(--color-atlas-ink)] no-underline hover:underline"
                  >
                    {p.pathTitle}
                  </a>
                  <span className="text-xs text-[var(--color-atlas-muted)]">
                    {p.lastProgressedAt
                      ? `last activity ${fmtRelative(p.lastProgressedAt)}`
                      : "not started"}
                  </span>
                </div>
                <ProgressBar
                  completedCount={p.completedCount}
                  requiredCount={p.requiredCount}
                  percent={p.percent}
                />
                {p.nextTopicId && (
                  <a
                    href={continueHref(p.pathId, p.nextTopicId)}
                    className="mt-3 inline-flex items-center gap-1 text-sm text-[var(--color-atlas-accent)] no-underline hover:underline"
                  >
                    Resume here
                    <span aria-hidden="true">→</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Completed */}
      {completed.length > 0 && (
        <section aria-label="Completed paths">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
            Completed
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {completed.map((p) => (
              <li
                key={p.pathId}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] px-3 py-2"
              >
                <a
                  href={`/p/${p.pathId}`}
                  className="text-sm font-medium text-[var(--color-atlas-ink)] no-underline hover:underline"
                >
                  {p.pathTitle}
                </a>
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  100%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent topics */}
      {recentTopics.length > 0 && (
        <section aria-label="Recently completed">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
            Recently completed
          </h2>
          <ul className="mt-3 divide-y divide-[var(--color-atlas-line)] rounded-md border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)]">
            {recentTopics.map((r, i) => (
              <li
                key={`${r.pathId}-${r.topicId}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2"
              >
                <a
                  href={continueHref(r.pathId, r.topicId)}
                  className="text-sm text-[var(--color-atlas-ink)] no-underline hover:underline"
                >
                  {r.topicTitle}
                </a>
                <span className="text-xs text-[var(--color-atlas-muted)]">
                  in {r.pathTitle} · {fmtDate(r.completedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RankCard({ rank }: { rank: RankProgress }) {
  const maxed = rank.nextName === null;
  return (
    <section aria-label="Rank">
      <div className="rounded-lg border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
              Rank
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-[var(--color-atlas-ink)]">
              {rank.name}
            </h2>
          </div>
          <p className="text-right text-sm text-[var(--color-atlas-muted)]">
            <span className="text-xl font-semibold text-[var(--color-atlas-accent)]">
              {rank.xp.toLocaleString()}
            </span>{" "}
            XP
          </p>
        </div>
        <div className="mt-4">
          <div
            role="progressbar"
            aria-valuenow={rank.percentToNext}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={
              maxed
                ? "Top rank reached"
                : `${rank.toNext} XP to ${rank.nextName}`
            }
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-atlas-line)]"
          >
            <div
              className="h-full bg-[var(--color-atlas-accent)] transition-[width]"
              style={{ width: `${rank.percentToNext}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-atlas-muted)]">
            {maxed
              ? "Top rank reached — Bare-Metal Wizard."
              : `${rank.toNext.toLocaleString()} XP to ${rank.nextName}`}
          </p>
        </div>
      </div>
    </section>
  );
}

const GRID_WEEKS = 26;

/** Tailwind/inline tiers for a day's completion count. */
function cellStyle(count: number): { className: string; style?: { opacity: number } } {
  if (count <= 0) {
    return { className: "bg-[var(--color-atlas-line)]" };
  }
  const opacity = count === 1 ? 0.4 : count <= 3 ? 0.65 : 1;
  return { className: "bg-[var(--color-atlas-accent)]", style: { opacity } };
}

function dayLabel(day: number, count: number): string {
  const date = new Date(day * MS_PER_DAY).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  if (count <= 0) return `${date}: no topics`;
  return `${date}: ${count} topic${count === 1 ? "" : "s"}`;
}

function ContributionGrid({ days }: { days: ProgressActivity["days"] }) {
  const counts = new Map<number, number>(days);
  const today = dayIndex(Date.now());
  // Epoch day 0 is a Thursday, so (day + 4) % 7 gives 0 = Sunday.
  const todayDow = (today + 4) % 7;
  const lastSunday = today - todayDow;
  const firstSunday = lastSunday - (GRID_WEEKS - 1) * 7;

  const weeks = Array.from({ length: GRID_WEEKS }, (_, col) =>
    Array.from({ length: 7 }, (_, row) => firstSunday + col * 7 + row),
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]" role="img" aria-label="Daily activity over the last 26 weeks">
        {weeks.map((week, col) => (
          <div key={col} className="flex flex-col gap-[3px]">
            {week.map((day) => {
              if (day > today) {
                return <div key={day} className="h-3 w-3" aria-hidden="true" />;
              }
              const count = counts.get(day) ?? 0;
              const { className, style } = cellStyle(count);
              return (
                <div
                  key={day}
                  className={`h-3 w-3 rounded-[2px] ${className}`}
                  style={style}
                  title={dayLabel(day, count)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityCard({ activity }: { activity: ProgressActivity }) {
  return (
    <section aria-label="Activity">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-atlas-muted)]">
        Activity
      </h2>
      <div className="mt-3 rounded-lg border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] p-5">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <p className="text-sm text-[var(--color-atlas-muted)]">
            <span className="mr-1 text-xl font-semibold text-[var(--color-atlas-ink)]">
              {activity.streakCurrent === 0 ? "—" : `🔥 ${activity.streakCurrent}`}
            </span>
            day{activity.streakCurrent === 1 ? "" : "s"} current streak
          </p>
          <p className="text-sm text-[var(--color-atlas-muted)]">
            <span className="mr-1 text-xl font-semibold text-[var(--color-atlas-ink)]">
              {activity.streakLongest}
            </span>
            day{activity.streakLongest === 1 ? "" : "s"} longest
          </p>
        </div>
        <div className="mt-4">
          <ContributionGrid days={activity.days} />
          <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-[var(--color-atlas-muted)]">
            <span>Less</span>
            <span className="h-3 w-3 rounded-[2px] bg-[var(--color-atlas-line)]" />
            <span
              className="h-3 w-3 rounded-[2px] bg-[var(--color-atlas-accent)]"
              style={{ opacity: 0.4 }}
            />
            <span
              className="h-3 w-3 rounded-[2px] bg-[var(--color-atlas-accent)]"
              style={{ opacity: 0.65 }}
            />
            <span className="h-3 w-3 rounded-[2px] bg-[var(--color-atlas-accent)]" />
            <span>More</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function BadgeCard({ badge }: { badge: Badge }) {
  const maxed = badge.earned && badge.nextAt === null;
  const title = badge.tierName ?? badge.family;
  const detail = maxed
    ? "Maxed out"
    : `${badge.value} / ${badge.nextAt} ${badge.unit}`;
  return (
    <li
      className={`rounded-lg border p-4 ${
        badge.earned
          ? "border-[var(--color-atlas-accent)]/40 bg-[var(--color-atlas-accent-soft)]"
          : "border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">
          {badge.earned ? "🏅" : "🔒"}
        </span>
        <div className="min-w-0">
          <p
            className={`truncate text-sm font-semibold ${
              badge.earned
                ? "text-[var(--color-atlas-ink)]"
                : "text-[var(--color-atlas-muted)]"
            }`}
          >
            {title}
          </p>
          <p className="text-xs text-[var(--color-atlas-muted)]">{detail}</p>
        </div>
      </div>
      {!maxed && (
        <div
          role="progressbar"
          aria-valuenow={badge.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${title}: ${detail}`}
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-atlas-line)]"
        >
          <div
            className="h-full bg-[var(--color-atlas-accent)]"
            style={{ width: `${badge.percent}%` }}
          />
        </div>
      )}
    </li>
  );
}

function ProgressBar({
  completedCount,
  requiredCount,
  percent,
}: {
  completedCount: number;
  requiredCount: number;
  percent: number;
}) {
  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${completedCount} of ${requiredCount} complete`}
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-atlas-line)]"
      >
        <div
          className="h-full bg-[var(--color-atlas-accent)] transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-[var(--color-atlas-muted)]">
        {completedCount} of {requiredCount} complete · {percent}%
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] p-3">
      <dt>{label}</dt>
      <dd className="text-xl font-semibold text-[var(--color-atlas-ink)]">
        {value}
      </dd>
      {hint && (
        <dd className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--color-atlas-muted)]">
          {hint}
        </dd>
      )}
    </div>
  );
}
