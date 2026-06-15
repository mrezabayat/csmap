# Gamification Plan

> **Status (2026-06-15):** **G1–G4 shipped.** G1 (XP + ranks), G2 (streaks + contribution grid), G3 (Fog of War) are pure derivations in `src/lib/gamification.ts` / `src/lib/fog.ts`, wired into `GET /api/progress/me` and surfaced in `MeDashboard.tsx` / `LearningProgressRoadmap.tsx` — no migration. **G4 (checkpoint quizzes)** adds the plan's one migration (`0002_topic_mastery`): sibling `<topic>.quiz.json` (validated by `lint-content.mjs` against `src/lib/quiz.ts`), graded client-side in the `TopicQuiz.tsx` island, pass → `POST /api/mastery` (earliest-wins upsert). Two-tier model — "Mastered" is a separate per-topic tier above "marked read", awarding bonus XP. `astro check` clean (67 files); `lint:content` green (2 quizzes); `gradeQuiz`/`validateQuiz`/`computeStreak`/`computeFog`/grid geometry unit-checked; migration `0002` applies cleanly to local D1; the cap-theorem quiz grades 3/3 → "Passed" end-to-end in the browser; mastery API returns correct 401/400. **G3 design note:** a scan of all 25 paths found **zero** in-path prerequisite chains, so the plan's prerequisite-only fog was inert — G3 ships as *sequential* unlock (each step gated on the previous required topic), keeping prerequisite-gating as a fallback (§3.1). **G5 (badges)** is `src/lib/badges.ts` (tiered families) → `badges[]` on `/me` → badge grid in `MeDashboard.tsx`, pure derivation over G1–G4 data. **G6 (leaderboard)** is the plan's one social feature: `GET /api/leaderboard` aggregates `COUNT(DISTINCT user_id)` per topic, cached in the new `LEADERBOARD_KV` binding (lazy cache, not a cron — the adapter has no `scheduled()` hook; degrades to live D1 if KV is absent), surfaced via the public `PopularTopics.tsx` island on `/me`. Verified: `evaluateBadge` unit-checked across tiers; `astro check` clean (70 files); leaderboard ranks/dedupes correctly with a KV cache-hit confirmed against seeded local data. **All six phases (G1–G6) shipped. Remaining work is the deferred anonymous-persistence + merge (§1.1, §7.1) and two deploy steps below.**
>
> **Deploy steps before production:** (1) `npm run db:migrate:remote` (applies `0002_topic_mastery`); (2) `wrangler kv namespace create LEADERBOARD_KV` and paste the id into `wrangler.jsonc` (leaderboard serves live/uncached until then).
>
> Written against the *current* stack — Astro SSR on the Cloudflare adapter, better-auth + D1 (Drizzle), and the existing `learning_progress` table + `/api/progress` and `/api/progress/me` endpoints. This plan deliberately adds **zero new tables** for the first three mechanics; gamification is derived from completion events already stored. See `enrichment-plan.md` and `content-roadmap.md` for the content substrate this builds on.

---

## 1. Guiding principle — *derive, don't store*

The platform already records the only thing that is a genuine fact: **"user `U` completed topic `T` in path `P` at time `completed_at`."** (`migrations/0001_auth_and_progress.sql`, table `learning_progress`.)

Everything we want to add — XP, ranks, streaks, badges, fog-of-war unlock state — is a **pure function of `(completion events × the static content graph)`**. We compute it at read time; we do **not** persist parallel mutable counters.

| Anti-pattern (avoid) | This plan |
|---|---|
| New `user_xp`, `user_streak`, `user_badges` tables | **Zero new tables** for mechanics 1–3 |
| Every completion bumps counters (extra writes) | **No new write path** — the one `INSERT … ON CONFLICT` we already do is unchanged |
| Counter races; badges that desync from reality | Reproducible — recompute and it is always correct |
| Extra D1 round-trips on the hot path | `/api/progress/me` **already** loads the rows + graph; XP/streak are ~free marginal CPU |

**Edge-native consequence:** the completion-toggle path (`PUT /api/progress`) stays exactly as fast as it is today. All "game" logic runs at read time over data already in worker memory, well inside the CPU budget.

### 1.1 Anonymous vs signed-in (one code path)

The derivation functions take a `Set<topicId>` / an array of `{ topicId, completedAt }`. The **source** of that data differs; the math does not.

- **Anonymous:** completion events live in `localStorage` (an append-only event log). Derivation runs entirely client-side. No network.
- **Signed-in:** the events come from D1 via the existing endpoints. Same functions, server-side or client-side.
- **Sign-in merge:** on first authenticated load, merge the local event log into D1 once (idempotent — `INSERT … ON CONFLICT DO NOTHING`), then clear local. This avoids the "re-fogged map on a new device" bug.

---

## 2. The headline question — where do quizzes go: topic, path, or category?

**Decision: quizzes attach to the _topic_, surfaced as _checkpoints_ inside paths. Not categories.**

| Level | Verdict | Reasoning |
|---|---|---|
| **Topic** | ✅ **Primary home** | A topic is the atomic unit of knowledge and already the unit of `learning_progress`. A 1–3 question check maps cleanly to "this topic is mastered." Quiz content versions with the topic MDX. |
| **Path** | ✅ **Surfaced here, not authored here** | A path is an *ordering* of topics. Its quiz is just the topic checkpoints encountered in sequence — a path "exam" is the union of its topics' checkpoints. Optionally add **one** capstone question per path section to test synthesis, but don't duplicate per-topic questions. |
| **Category** | ❌ **No quiz** | A category (18 of them) is a *browsing/IA bucket* of 15–30 loosely related topics, not a learning sequence. A category-level quiz has no natural "you just learned this" moment and would feel like a final exam dropped on a reference page. Use a **completion badge** ("Security & Privacy: 21/21") instead — derived, not quizzed. |

### 2.1 Why topic-anchored quizzes are the right edge-native choice

- **Content, not config.** Quiz questions ship *with the site* (topic frontmatter or a co-located JSON imported at build). They serve from the static-asset edge cache at ~0 ms. **Do not** put them in KV — that adds a binding and a read for data that is already free as a build artifact, and decouples questions from the topic they test (drift risk, exactly what `enrichment-plan.md §2` warns against for metadata).
- **Grade client-side.** The answer key is in the bundle anyway; this is a *learning aid*, not a proctored exam, so there is no cheating threat worth a round-trip. Instant feedback, zero worker CPU.
- **Reuse the write path.** A *passed* checkpoint writes through the **existing** `PUT /api/progress` (optionally with a new `via: "quiz"` discriminator to distinguish quiz-mastery from a manual check-off). No new endpoint, no new table.

### 2.2 Quiz authoring shape (proposed)

Co-locate with the topic so it versions together. Two options, pick one in implementation:

- **(a) Frontmatter block** on the topic MDX (`content.config.ts` gets an optional `quiz` array). Pro: single file. Con: bloats frontmatter for long quizzes.
- **(b) Sibling file** `src/content/topics/<topic>.quiz.json`, imported by the topic layout. Pro: clean separation, lazy-importable. **← leaning this way.**

```jsonc
// <topic>.quiz.json — graded client-side in the island
{
  "topic": "cap-theorem",
  "questions": [
    {
      "q": "Under a network partition, CAP says you must sacrifice…",
      "choices": ["Consistency or Availability", "Latency", "Durability"],
      "answer": 0,
      "explain": "P is non-negotiable on a real network; you trade C against A."
    }
  ]
}
```

A new lint rule (sibling to `lint-content.mjs`) validates the shape and that `answer` indexes into `choices`. Quizzes are **optional per topic** — roll out as authored, gated on `kind` like the v2 sections (no quiz for `person` / `organization` / `historical-event`).

---

## 3. The four mechanics

### 3.1 Fog of War (unlock map) — client-side derivation ✅ *shipped, redesigned*

**Original idea:** lock a topic until its `prerequisites` are all in the completed set.

**What the data forced:** a scan of **all 25 paths found zero in-path prerequisite chains** — paths consistently point their `prerequisites` at foundational topics that live *outside* the path (assumed background). Prerequisite-only fog would therefore never render a single lock. Equally, the roadmap island only fetches *per-path* completions (`/api/progress?pathId=`), so honouring out-of-path prerequisites would false-lock topics whose prereqs were completed elsewhere.

**Shipped design — sequential unlock.** A path is an ordered roadmap, so each step stays fogged until the **previous required topic** is complete, revealing the map one step at a time (the head topic is never gated). In-path prerequisites are still honoured as an extra gate, so a future path with real chains "just works." Both gates are in-path only, so every lock is satisfiable from the same screen.

- **Split:** 100% client render. Pure math over the ordered topic list + the `Set<topicId>` the island already holds.
- **Storage:** none. Signed-in → the per-path D1 set from `GET /api/progress`; anonymous → no fog yet (shows the full map — localStorage fog is deferred with the §1.1 merge work). Soft-lock only: fogged steps stay clickable and checkable; the lock is motivational, not a hard gate.
- **Code:** `src/lib/fog.ts` `computeFog(orderedTopics, completed) → Map<id, { locked, missing }>`; rendered in `LearningProgressRoadmap.tsx` (dim + 🔒 + "Complete first: …" hint), gated on `state === "ready"` so signed-out visitors don't hit a wall of locks.

### 3.2 XP + Ranks — derived, ~free

XP = Σ over completed topics of `weight(importance) × weight(level)` (both fields already exist). Rank is a threshold table. **No storage.** Fold into `GET /api/progress/me`, which already has `rows` + the graph in scope.

```ts
const W_IMPORTANCE = { core: 30, important: 20, supplemental: 10 } as const;
const W_LEVEL = { beginner: 1, intermediate: 1.5, advanced: 2 } as const;

let xp = 0;
for (const row of rows) {
  const t = topicsById.get(row.topic_id);
  if (!t) continue;
  xp += Math.round(W_IMPORTANCE[t.data.importance] * W_LEVEL[t.data.level]);
}

const RANKS = [
  [0, "Script Kiddie"], [300, "Junior Dev"], [900, "Systems Thinker"],
  [2000, "Architect"], [4000, "Bare-Metal Wizard"],
] as const;
const rank = RANKS.reduce((acc, [min, name]) => (xp >= min ? name : acc), "Script Kiddie");
```

### 3.3 Streaks + contribution grid — derived from `completed_at`

No new table — `completed_at` already exists. For the streak number, bucket timestamps by UTC day and walk backwards. For the GitHub-style grid, aggregate in D1 so the payload stays tiny:

```sql
SELECT completed_at / 86400000 AS day, COUNT(*) AS n
FROM learning_progress WHERE user_id = ?1
GROUP BY day;
```

Rank names ("Script Kiddie → Bare-Metal Wizard") can key off streak length as well as XP — both are derived, so this is a presentation choice, not a storage one.

### 3.4 Checkpoint quizzes — ✅ *shipped (two-tier mastery)*

Topic-anchored, bundled content, graded client-side. **Shipped 2026-06-15.**

- **Content:** sibling `<topic>.quiz.json` next to the topic MDX (resolved Q1). Validated by a new `lint-content.mjs` rule against the canonical contract in `src/lib/quiz.ts` (`validateQuiz`). Two authored to date: `cap-theorem`, `tcp`.
- **Grading:** pure `gradeQuiz` in `src/lib/quiz.ts`, run in the `TopicQuiz.tsx` island (`client:visible`). `PASS_RATIO = 1` (short quizzes → ace it). The Worker never re-grades — the key ships with the page (a learning aid, not a proctored exam).
- **Two-tier model (resolved Q2):** passing is a *separate* "Mastered" tier above "marked read", not a discriminator on the completion row. It lives in a dedicated **`topic_mastery (user_id, topic_id, mastered_at)`** table (migration `0002`) — keyed per-*topic*, because `learning_progress` is per-*path* and mastery is path-independent. `POST /api/mastery` upserts with **earliest-wins** (`MIN`, resolved Q4), ready for the future anon→signed-in merge. Mastery awards the topic's XP **again** on top of completion XP (premium tier), surfaced as a "Mastered" stat on the dashboard.
- **Mount:** `TopicLayout.astro` resolves the topic's quiz via `import.meta.glob` and renders the island only when a quiz file exists.
- **Path capstones (resolved Q3):** baseline is the pure union of topic checkpoints; the per-section "gatekeeper" synthesis question is a documented future hook, not built.

### 3.5 Explicitly deferred — Offline Scout badges

Worst effort-to-payoff ratio for a reference site: a hand-written service worker (the CF adapter ships none by default), an IndexedDB queue, and conflict-merge logic — to detect that someone read pages offline. If we want offline *reading*, ship a content-caching service worker and skip the *badge*. **Not in scope** for v1.

---

## 4. Badges — derived milestones, not records ✅ *shipped (G5)*

**Shipped 2026-06-15.** Implemented as *tiered families* rather than one-off predicates: `src/lib/badges.ts` (`evaluateBadge`, `BADGE_DEFS`, `ringScholarDef`) resolves a user's value against ascending thresholds and returns the earned tier + progress to the next. Computed in `GET /api/progress/me` (the graph is already loaded, so category/core/path totals are a single pass), surfaced as a badge grid in `MeDashboard.tsx`. No `badges` table — every badge is a pure function of completion + mastery data. Families shipped: Explorer (topics read), Scholar (mastered), Streak Keeper (longest streak), Cartographer (categories completed), Trailblazer (paths completed), and the dynamic Ring 1 Scholar (all `importance: core`).

The original predicate sketch (kept for reference):

| Badge | Predicate (pure function) |
|---|---|
| Category Cartographer: `<cat>` | all topics with `category == <cat>` are completed |
| Path Complete: `<path>` | all *required* topics in path are completed (we already compute `percent`) |
| First Checkpoint | ≥1 row in `topic_mastery` |
| Streak: 7 / 30 days | `streak.current >= 7 / 30` |
| Ring 1 Scholar | all `importance: core` topics completed |

Earned badges are a *view*; we never write a `badges` row. (If we later want "earned at" timestamps for a trophy case, that's the first justified new table — defer until asked.)

---

## 5. The one place new storage is justified — global/social state ✅ *shipped (G6)*

Everything above needs **zero** new storage. The exception is **cross-user aggregates** — "1,204 learners completed CAP Theorem," leaderboards — which are *not* a function of one user's events.

- **Tool: Cloudflare KV.** Write-rarely, read-hot, eventual consistency is fine. New `LEADERBOARD_KV` binding (`env.d.ts` + `wrangler.jsonc`), **optional** so the route degrades to a live D1 query when the namespace isn't provisioned.
- **Shipped pattern — lazy cache, not Cron.** The Astro Cloudflare adapter exposes no `scheduled()` hook, so instead of a Cron Trigger, `GET /api/leaderboard` checks KV; on a miss it runs one `GROUP BY` (`COUNT(DISTINCT user_id)` per topic — a topic completed in several paths counts the learner once), enriches titles from the graph, writes the snapshot to KV with a 15-min TTL via `ctx.waitUntil` (off the response path), and serves it. This is arguably *more* efficient than a cron — zero compute when nobody's looking — and identical read characteristics (sub-ms KV hit). Surfaced publicly via the `PopularTopics.tsx` island on `/me`.
- **Deploy step:** run `wrangler kv namespace create LEADERBOARD_KV` and paste the id into `wrangler.jsonc` (placeholder there now). Until then it silently serves live (uncached) results.

The original Cron sketch (kept for reference):

```ts
// scheduled() handler — off the hot path
export async function recomputeLeaderboard(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT topic_id, COUNT(*) AS n FROM learning_progress GROUP BY topic_id`,
  ).all<{ topic_id: string; n: number }>();
  await env.KV.put("agg:topic-completions", JSON.stringify(results), {
    expirationTtl: 3600,
  });
}
```

This is the sharpened version of "KV for badges": **KV for aggregates, never for per-user state.**

---

## 6. Rollout order

| Phase | Deliverable | New storage | Notes |
|---|---|---|---|
| **G1** ✅ | XP + rank in `GET /api/progress/me`; surface in `MeDashboard.tsx` | none | **Shipped 2026-06-15.** `src/lib/gamification.ts` (pure) + `rank` on the `/me` payload + rank card. No migration. |
| **G2** ✅ | Streak + contribution grid | none | **Shipped 2026-06-15.** `computeStreak` in `gamification.ts` + `activity` on the `/me` payload (bucketed from rows already loaded — no extra query) + `ActivityCard`/`ContributionGrid` (26 weeks). |
| **G3** ✅ | Fog of War — **sequential** unlock in the roadmap (prereq-gating kept as fallback) | none | **Shipped 2026-06-15.** `src/lib/fog.ts` + locked-step rendering in `LearningProgressRoadmap.tsx` + prerequisites fed via `PathLayout.astro`. Redesigned from prereq-only after finding 0 in-path chains across 25 paths (§3.1). |
| **G4** ✅ | Checkpoint quizzes: `quiz.ts` + lint + sibling `.quiz.json` + `TopicQuiz` island; pass → `POST /api/mastery` | **`topic_mastery`** | **Shipped 2026-06-15.** Two-tier mastery (separate per-topic table, migration `0002`), earliest-wins upsert, mastery XP bonus + dashboard stat. The one migration in the plan; additive. |
| **G5** ✅ | Derived badges (tiered families) | none | **Shipped 2026-06-15.** `src/lib/badges.ts` + `badges[]` on `/me` + badge grid in `MeDashboard.tsx`. Pure functions over G1–G4 data. |
| **G6** ✅ | KV leaderboard — **lazy-cached API route** (no cron; adapter has no `scheduled()`) | **KV** | **Shipped 2026-06-15.** `LEADERBOARD_KV` binding + `GET /api/leaderboard` (degrades without KV) + `PopularTopics.tsx`. Needs `wrangler kv namespace create` to enable caching. |

**Throughline:** completion events are the substrate; gamification is a *lens* over them, not new data. Every write path stays exactly as fast as it is today, and no badge can ever desync from reality.

---

## 7. Open questions — resolved for G4 (2026-06-15)

1. **Quiz storage shape → sibling `<topic>.quiz.json`.** Keeps MDX prose clean, gives a focused JSON validator, lazy-load friendly. (§2.2, §3.4.)
2. **Passed quiz → separate "Mastered" tier**, not equal to completion. "Marked read" clears the visual pipeline / fog; "Mastered" is an upgrade earned by the quiz, with premium XP. Implemented as a dedicated per-topic `topic_mastery` table — **not** a `via` discriminator on the per-path completion row, because mastery is path-independent and that row's PK is `(user_id, path_id, topic_id)`. (§3.4.)
3. **Path capstones → pure union** of topic checkpoints for baseline; per-section "gatekeeper" synthesis question kept as an optional future hook. (§2 table.)
4. **Merge semantics → earliest-wins** on `completed_at` / `mastered_at` (preserves authentic history + streak integrity). Baked into the `topic_mastery` upsert now (`MIN`); the actual anon→signed-in merge is still deferred (no anonymous write path exists yet — §1.1).

### 7.1 Remaining open questions (post-G4)

- **Anonymous persistence + merge (§1.1):** the localStorage event log and the one-time merge into D1 aren't built. Until then, Fog of War and quiz mastery only persist for signed-in users; anonymous visitors see the full map and can take quizzes but can't save mastery. This is now the **only** unshipped item in the plan.
- **Quiz coverage:** only 2 of 334 topics have a `.quiz.json` (cap-theorem, tcp). Authoring more is incremental content work, not engineering.
