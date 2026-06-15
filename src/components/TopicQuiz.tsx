import { useEffect, useMemo, useState } from "react";
import { gradeQuiz, type Quiz, type QuizResult } from "~/lib/quiz";

interface Props {
  topicId: string;
  quiz: Quiz;
}

type MasteryLoad = "loading" | "signed-in" | "signed-out" | "error";

export default function TopicQuiz({ topicId, quiz }: Props) {
  const [load, setLoad] = useState<MasteryLoad>("loading");
  const [mastered, setMastered] = useState(false);
  const [answers, setAnswers] = useState<number[]>(() =>
    quiz.questions.map(() => -1),
  );
  const [result, setResult] = useState<QuizResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Find out whether this topic is already mastered (and whether we're signed in).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/mastery", {
          headers: { accept: "application/json" },
        });
        if (cancelled) return;
        if (r.status === 401) {
          setLoad("signed-out");
          return;
        }
        if (!r.ok) {
          setLoad("error");
          return;
        }
        const data = (await r.json()) as { masteredTopicIds?: string[] };
        setMastered(Boolean(data.masteredTopicIds?.includes(topicId)));
        setLoad("signed-in");
      } catch {
        if (!cancelled) setLoad("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  const allAnswered = answers.every((a) => a >= 0);

  const select = (qi: number, ci: number) => {
    if (result) return; // locked after submit until retake
    setAnswers((prev) => {
      const next = [...prev];
      next[qi] = ci;
      return next;
    });
  };

  const submit = async () => {
    const graded = gradeQuiz(quiz, answers);
    setResult(graded);
    setSaveError("");
    if (graded.passed && load === "signed-in" && !mastered) {
      setSaving(true);
      try {
        const r = await fetch("/api/mastery", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ topicId }),
        });
        if (r.ok) setMastered(true);
        else if (r.status === 401) setLoad("signed-out");
        else setSaveError("Couldn't save mastery — try again.");
      } catch {
        setSaveError("Couldn't save mastery — try again.");
      } finally {
        setSaving(false);
      }
    }
  };

  const retake = () => {
    setAnswers(quiz.questions.map(() => -1));
    setResult(null);
    setSaveError("");
  };

  const headingId = useMemo(() => `quiz-${topicId}`, [topicId]);

  return (
    <section
      className="not-prose mt-10 rounded-lg border border-[var(--color-atlas-line)] bg-[var(--color-atlas-surface)] p-5"
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={headingId}
          className="text-base font-semibold text-[var(--color-atlas-ink)]"
        >
          Checkpoint quiz
        </h2>
        {mastered && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-atlas-accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-atlas-accent)]">
            🎓 Mastered
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--color-atlas-muted)]">
        Answer all {quiz.questions.length} to master this topic.
      </p>

      <ol className="mt-4 space-y-5">
        {quiz.questions.map((qn, qi) => {
          const chosen = answers[qi];
          const isRight = result?.perQuestion[qi];
          return (
            <li key={qi}>
              <fieldset>
                <legend className="text-sm font-medium text-[var(--color-atlas-ink)]">
                  {qi + 1}. {qn.q}
                </legend>
                <div className="mt-2 space-y-1.5">
                  {qn.choices.map((choice, ci) => {
                    const selected = chosen === ci;
                    // After grading, tint the correct answer and a wrong pick.
                    let tone =
                      "border-[var(--color-atlas-line)] text-[var(--color-atlas-ink)]";
                    if (result) {
                      if (ci === qn.answer) {
                        tone =
                          "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200";
                      } else if (selected) {
                        tone =
                          "border-red-300 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200";
                      }
                    } else if (selected) {
                      tone =
                        "border-[var(--color-atlas-accent)] bg-[var(--color-atlas-accent-soft)]";
                    }
                    return (
                      <label
                        key={ci}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${tone} ${
                          result ? "cursor-default" : ""
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${headingId}-q${qi}`}
                          checked={selected}
                          disabled={Boolean(result)}
                          onChange={() => select(qi, ci)}
                          className="mt-0.5 accent-[var(--color-atlas-accent)]"
                        />
                        <span>{choice}</span>
                      </label>
                    );
                  })}
                </div>
                {result && (
                  <p
                    className={`mt-2 text-xs ${
                      isRight
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-[var(--color-atlas-muted)]"
                    }`}
                  >
                    {isRight ? "Correct. " : "Not quite. "}
                    {qn.explain}
                  </p>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!result ? (
          <button
            type="button"
            onClick={submit}
            disabled={!allAnswered}
            className="rounded-md bg-[var(--color-atlas-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Submit
          </button>
        ) : (
          <button
            type="button"
            onClick={retake}
            className="rounded-md border border-[var(--color-atlas-line)] px-3 py-1.5 text-sm font-medium text-[var(--color-atlas-ink)]"
          >
            Retake
          </button>
        )}

        {result && (
          <p className="text-sm" aria-live="polite">
            <span className="font-semibold text-[var(--color-atlas-ink)]">
              {result.correct} / {result.total} correct
            </span>
            {result.passed ? (
              <span className="ml-2 text-emerald-700 dark:text-emerald-300">
                {saving
                  ? "Saving…"
                  : mastered
                    ? "🎓 Topic mastered!"
                    : load === "signed-out"
                      ? "Passed — sign in to save mastery."
                      : "Passed!"}
              </span>
            ) : (
              <span className="ml-2 text-[var(--color-atlas-muted)]">
                Review the explanations and retake to master it.
              </span>
            )}
          </p>
        )}
      </div>

      {saveError && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
