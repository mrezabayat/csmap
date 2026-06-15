/**
 * Checkpoint quizzes (gamification plan G4, §2).
 *
 * Quiz content is authored as a sibling `<topic>.quiz.json` next to the topic
 * MDX and ships bundled with the site — it serves from the static-asset edge
 * cache, versions with the topic, and is graded **client-side** (the answer key
 * is in the bundle anyway; this is a learning aid, not a proctored exam). The
 * Worker only records the *pass*, never re-grades.
 *
 * This module is the shared, dependency-free contract: the types, the runtime
 * validator (used by `lint-content.mjs`), and the pure `gradeQuiz` used by the
 * island. Keep it free of `astro:content` so it runs in the browser too.
 */

export interface QuizQuestion {
  /** The prompt. */
  q: string;
  /** Two or more answer options. */
  choices: string[];
  /** Index into `choices` of the correct option. */
  answer: number;
  /** Shown after submission, regardless of correctness. */
  explain: string;
}

export interface Quiz {
  /** Topic id this quiz belongs to (must match the sibling MDX filename). */
  topic: string;
  questions: QuizQuestion[];
}

/** Fraction of questions that must be correct to pass. Short quizzes → ace it. */
export const PASS_RATIO = 1;

export interface QuizResult {
  correct: number;
  total: number;
  passed: boolean;
  /** Per-question correctness, index-aligned with `quiz.questions`. */
  perQuestion: boolean[];
}

/**
 * Grade answers against a quiz. `answers[i]` is the chosen choice index for
 * question `i` (or `-1`/undefined for unanswered). Pure and allocation-light.
 */
export function gradeQuiz(quiz: Quiz, answers: readonly number[]): QuizResult {
  const perQuestion = quiz.questions.map((qn, i) => answers[i] === qn.answer);
  const correct = perQuestion.filter(Boolean).length;
  const total = quiz.questions.length;
  const passed = total > 0 && correct / total >= PASS_RATIO;
  return { correct, total, passed, perQuestion };
}

/**
 * Validate an unknown value as a `Quiz`. Returns an error string, or null when
 * valid. Shared by the content linter so the runtime contract has one source of
 * truth. `expectedTopic`, when given, asserts the `topic` field matches.
 */
export function validateQuiz(
  value: unknown,
  expectedTopic?: string,
): string | null {
  if (typeof value !== "object" || value === null) return "not an object";
  const quiz = value as Record<string, unknown>;

  if (typeof quiz.topic !== "string" || quiz.topic.length === 0) {
    return "`topic` must be a non-empty string";
  }
  if (expectedTopic && quiz.topic !== expectedTopic) {
    return `\`topic\` is "${quiz.topic}" but the file is named for "${expectedTopic}"`;
  }
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    return "`questions` must be a non-empty array";
  }

  for (let i = 0; i < quiz.questions.length; i++) {
    const qn = quiz.questions[i] as Record<string, unknown>;
    const where = `question ${i + 1}`;
    if (typeof qn?.q !== "string" || qn.q.length === 0) {
      return `${where}: \`q\` must be a non-empty string`;
    }
    if (!Array.isArray(qn.choices) || qn.choices.length < 2) {
      return `${where}: \`choices\` must have at least 2 options`;
    }
    if (!qn.choices.every((c) => typeof c === "string" && c.length > 0)) {
      return `${where}: every choice must be a non-empty string`;
    }
    if (
      typeof qn.answer !== "number" ||
      !Number.isInteger(qn.answer) ||
      qn.answer < 0 ||
      qn.answer >= qn.choices.length
    ) {
      return `${where}: \`answer\` must be an integer index into \`choices\``;
    }
    if (typeof qn.explain !== "string" || qn.explain.length === 0) {
      return `${where}: \`explain\` must be a non-empty string`;
    }
  }

  return null;
}
