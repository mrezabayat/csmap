#!/usr/bin/env node
/**
 * Content linter — checks topics & paths for things the Zod schema can't catch.
 *
 * Topics (all structures):
 *   - status: stub  -> no body checks (stubs are honest placeholders).
 *   - status: reviewed -> no TODO / FIXME / "(not yet written)" markers in body.
 *   - summary length <= 280 chars (also enforced by schema; nicer error).
 *   - no slug duplicated across relation fields.
 *   - taxonomy: `domain` must exist in src/lib/taxonomy.json; `subcategory`
 *     requires `domain` and must belong to it.
 *
 * Topics with structure: 1 (default — legacy six-heading body):
 *   - must contain the six standardized H2 headings.
 *
 * Topics with structure: 2 (enriched body, docs/enrichment-plan.md §4):
 *   - domain + subcategory required.
 *   - required H2 headings depend on `kind` (applicability matrix), in
 *     canonical order; "## Why it matters" is retired.
 *   - quality bars, enforced once status: reviewed (drafts may be incomplete):
 *     The Visual Map needs a ```mermaid fence; Under the Hood a language-tagged
 *     fence; Try it yourself a bash/sh/python fence; Learn next >= 3 /t/ links.
 *   - starred sections may opt out with an MDX comment marker
 *     "no-<section>: reason" (see OPT_OUT_MARKERS below).
 *
 * Paths:
 *   - must have at least 2 topics.
 *
 * Exit code 1 on any error.
 */

import { readFile } from "node:fs/promises";
import { readFileSync, globSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TAXONOMY = JSON.parse(
  readFileSync(join(REPO_ROOT, "src", "lib", "taxonomy.json"), "utf8"),
);

const V1_REQUIRED_HEADINGS = [
  "## In simple terms",
  "## More detail",
  "## Why it matters",
  "## Real-world examples",
  "## Common misconceptions",
  "## Learn next",
];

// Canonical v2 section order (docs/enrichment-plan.md §4.1).
const V2_ORDER = [
  "## In simple terms",
  "## The Visual Map",
  "## More detail",
  "## Under the Hood",
  "## Engineering Trade-offs",
  "## Real-world examples",
  "## Common misconceptions",
  "## Try it yourself",
  "## Learn next",
];

const BIO_KINDS = new Set(["person", "organization", "historical-event"]);

// Sections a topic may explicitly opt out of, and the marker that does it.
// Marker form: {/* no-visual-map: <reason> */} — the reason is mandatory.
const OPT_OUT_MARKERS = {
  "## The Visual Map": {
    name: "no-visual-map",
    re: /\{\/\*\s*no-visual-map:\s*[^*]*\S[^*]*\*\/\}/,
  },
  "## Under the Hood": {
    name: "no-under-the-hood",
    re: /\{\/\*\s*no-under-the-hood:\s*[^*]*\S[^*]*\*\/\}/,
  },
  "## Try it yourself": {
    name: "no-try-it-yourself",
    re: /\{\/\*\s*no-try-it-yourself:\s*[^*]*\S[^*]*\*\/\}/,
  },
};

/** Required v2 headings by kind (docs/enrichment-plan.md §4.2). */
function v2RequiredHeadings(kind) {
  if (BIO_KINDS.has(kind)) {
    return [
      "## In simple terms",
      "## More detail",
      "## Real-world examples",
      "## Common misconceptions",
      "## Learn next",
    ];
  }
  if (kind === "field") {
    return [
      "## In simple terms",
      "## The Visual Map",
      "## More detail",
      "## Engineering Trade-offs",
      "## Real-world examples",
      "## Common misconceptions",
      "## Learn next",
    ];
  }
  return V2_ORDER;
}

/** Headings that may be satisfied by an opt-out marker instead (starred in the matrix). */
function v2OptOutable(kind) {
  if (BIO_KINDS.has(kind) || kind === "field") return new Set();
  return new Set(Object.keys(OPT_OUT_MARKERS));
}

const FORBIDDEN_IN_REVIEWED = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /not yet written/i,
];

const errors = [];
const warnings = [];

function err(file, msg) {
  errors.push(`${file}: ${msg}`);
}

function splitFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  return { fm: m[1], body: m[2] };
}

function readField(fm, name) {
  const re = new RegExp(`^${name}:\\s*(.+)$`, "m");
  const m = fm.match(re);
  if (!m) return null;
  return m[1].trim();
}

function readList(text, name) {
  const inline = text.match(new RegExp(`^${name}:\\s*\\[([^\\]]*)\\]`, "m"));
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  const block = text.match(
    new RegExp(`^${name}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, "m"),
  );
  if (block) {
    return block[1]
      .split("\n")
      .filter((l) => /^\s+-\s+/.test(l))
      .map((l) => l.replace(/^\s+-\s+/, "").trim().replace(/^['"]|['"]$/g, ""));
  }
  return [];
}

const RELATION_FIELDS = ["prerequisites", "related", "partOf", "nextSteps"];

/** Extract the text of one H2 section (from its heading to the next H2 or EOF). */
function sectionText(body, heading) {
  const start = body.indexOf(`${heading}\n`);
  if (start === -1) {
    // Heading may be the very last line without a trailing newline.
    if (!body.trimEnd().endsWith(heading)) return null;
    return "";
  }
  const rest = body.slice(start + heading.length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function lintTaxonomy(file, fm, structure) {
  const domain = readField(fm, "domain")?.replace(/['"]/g, "") ?? null;
  const subcategory =
    readField(fm, "subcategory")?.replace(/['"]/g, "") ?? null;

  if (domain && !Object.hasOwn(TAXONOMY, domain)) {
    err(file, `unknown domain "${domain}" (see src/lib/taxonomy.json)`);
    return;
  }
  if (subcategory && !domain) {
    err(file, `subcategory "${subcategory}" set without a domain`);
    return;
  }
  if (domain && subcategory && !Object.hasOwn(TAXONOMY[domain].subcategories, subcategory)) {
    const valid = Object.keys(TAXONOMY[domain].subcategories).join(", ");
    err(
      file,
      `subcategory "${subcategory}" is not in domain "${domain}" (valid: ${valid})`,
    );
    return;
  }
  if (structure === 2 && (!domain || !subcategory)) {
    err(file, "structure: 2 requires both `domain` and `subcategory`");
  }
}

function lintV2Body(file, body, kind, status) {
  const required = v2RequiredHeadings(kind);
  const optOutable = v2OptOutable(kind);

  for (const h of required) {
    if (body.includes(h)) continue;
    if (optOutable.has(h) && OPT_OUT_MARKERS[h].re.test(body)) continue;
    const hint = optOutable.has(h)
      ? ` (or opt out with {/* ${OPT_OUT_MARKERS[h].name}: reason */})`
      : "";
    err(file, `missing required v2 heading "${h}"${hint}`);
  }

  if (body.includes("## Why it matters")) {
    err(
      file,
      `v2 body still has "## Why it matters" — merge it into More detail / Engineering Trade-offs / Real-world examples`,
    );
  }

  // Canonical order: every canonical heading that is present must appear in
  // V2_ORDER sequence.
  let last = -1;
  for (const h of V2_ORDER) {
    const idx = body.indexOf(`\n${h}\n`) !== -1 ? body.indexOf(`\n${h}\n`) : body.startsWith(`${h}\n`) ? 0 : -1;
    if (idx === -1) continue;
    if (idx < last) {
      err(file, `heading "${h}" is out of canonical order (see docs/enrichment-plan.md §4.1)`);
    }
    last = idx;
  }

  // Per-section quality bars — only once the topic claims to be reviewed;
  // drafts may have empty sections while being written.
  if (status !== "reviewed") return;

  const visualMap = sectionText(body, "## The Visual Map");
  if (visualMap !== null && !/```mermaid\b/.test(visualMap)) {
    err(file, "The Visual Map has no ```mermaid fence");
  }

  const underHood = sectionText(body, "## Under the Hood");
  if (underHood !== null && !/```[a-zA-Z][\w+-]*/.test(underHood)) {
    err(file, "Under the Hood has no language-tagged code fence");
  }

  const tryIt = sectionText(body, "## Try it yourself");
  if (tryIt !== null && !/```(bash|sh|shell|python|py)\b/.test(tryIt)) {
    err(file, "Try it yourself has no bash/sh/python code fence");
  }

  const learnNext = sectionText(body, "## Learn next");
  if (learnNext !== null) {
    const links = learnNext.match(/\]\(\/t\/[a-z0-9-]+/g) ?? [];
    if (links.length < 3) {
      err(file, `Learn next has ${links.length} internal /t/ link(s); v2 needs >= 3`);
    }
  }
}

async function lintTopic(file) {
  const src = await readFile(file, "utf8");
  const split = splitFrontmatter(src);
  if (!split) {
    err(file, "missing or malformed frontmatter");
    return;
  }
  const { fm, body } = split;

  const status = (readField(fm, "status") ?? "draft").replace(/['"]/g, "");
  const kind = (readField(fm, "kind") ?? "concept").replace(/['"]/g, "");
  const structure = Number(readField(fm, "structure") ?? "1");
  const summary = readField(fm, "summary") ?? "";
  const summaryText = summary.replace(/^['"]|['"]$/g, "").replace(/^\|\s*/, "");

  if (summaryText.length > 280) {
    err(file, `summary is ${summaryText.length} chars (max 280)`);
  }

  if (![1, 2].includes(structure)) {
    err(file, `invalid structure "${structure}" (must be 1 or 2)`);
    return;
  }

  lintTaxonomy(file, fm, structure);

  // Detect the same slug appearing in more than one relation field. Causes
  // duplicate arrows in the neighborhood graph and confuses readers.
  const seen = new Map(); // slug -> first field it appeared in
  for (const field of RELATION_FIELDS) {
    for (const slug of readList(fm, field)) {
      if (seen.has(slug) && seen.get(slug) !== field) {
        err(
          file,
          `"${slug}" appears in both \`${seen.get(slug)}\` and \`${field}\` — pick the stronger one (prerequisites > nextSteps > partOf > related).`,
        );
      } else {
        seen.set(slug, field);
      }
    }
  }

  if (status === "stub") return;

  if (structure === 2) {
    lintV2Body(file, body, kind, status);
  } else {
    for (const h of V1_REQUIRED_HEADINGS) {
      if (!body.includes(h)) {
        err(file, `missing required heading "${h}"`);
      }
    }
  }

  if (status === "reviewed") {
    for (const re of FORBIDDEN_IN_REVIEWED) {
      if (re.test(body)) {
        err(file, `status: reviewed but body contains ${re}`);
      }
    }
  }
}

async function lintPath(file) {
  const src = await readFile(file, "utf8");
  const split = splitFrontmatter(src);
  if (!split) {
    err(file, "missing or malformed frontmatter");
    return;
  }
  // Find the topics block: from "topics:" up to the next top-level key.
  // Topics can either be `  - slug` (one per line) or
  //   - ref: slug
  //     optional: true       (multi-line objects)
  // Count any line whose indentation is `^  -` (two-space + dash) as one entry.
  const blockMatch = split.fm.match(
    /^topics:\s*\n([\s\S]*?)(?=^[A-Za-z][\w-]*:|\Z)/m,
  );
  if (!blockMatch) {
    err(file, "no topics list found in frontmatter");
    return;
  }
  const items = blockMatch[1].split("\n").filter((l) => /^\s+-\s+/.test(l));
  if (items.length < 2) {
    err(file, `path has only ${items.length} topic(s); need at least 2`);
  }
}

/**
 * Validate a checkpoint quiz JSON (gamification G4). Mirrors the canonical
 * contract in src/lib/quiz.ts (`validateQuiz`) — kept inline because this script
 * runs under plain `node` with no TypeScript loader. Keep the two in sync.
 */
function lintQuiz(file, json, topicIds) {
  if (typeof json !== "object" || json === null) {
    err(file, "quiz is not a JSON object");
    return;
  }
  // Topic id is the filename minus the `.quiz.json` suffix.
  const base = file.split(/[\\/]/).pop().replace(/\.quiz\.json$/, "");
  if (!topicIds.has(base)) {
    err(file, `no topic named "${base}" — a quiz must sit beside its topic`);
  }
  if (typeof json.topic !== "string" || json.topic.length === 0) {
    err(file, "`topic` must be a non-empty string");
  } else if (json.topic !== base) {
    err(file, `\`topic\` is "${json.topic}" but the file is named for "${base}"`);
  }
  if (!Array.isArray(json.questions) || json.questions.length === 0) {
    err(file, "`questions` must be a non-empty array");
    return;
  }
  json.questions.forEach((qn, i) => {
    const where = `question ${i + 1}`;
    if (typeof qn?.q !== "string" || qn.q.length === 0) {
      err(file, `${where}: \`q\` must be a non-empty string`);
    }
    if (!Array.isArray(qn?.choices) || qn.choices.length < 2) {
      err(file, `${where}: \`choices\` must have at least 2 options`);
      return;
    }
    if (!qn.choices.every((c) => typeof c === "string" && c.length > 0)) {
      err(file, `${where}: every choice must be a non-empty string`);
    }
    if (
      typeof qn.answer !== "number" ||
      !Number.isInteger(qn.answer) ||
      qn.answer < 0 ||
      qn.answer >= qn.choices.length
    ) {
      err(file, `${where}: \`answer\` must be an integer index into \`choices\``);
    }
    if (typeof qn.explain !== "string" || qn.explain.length === 0) {
      err(file, `${where}: \`explain\` must be a non-empty string`);
    }
  });
}

async function lintQuizFile(file, topicIds) {
  const src = await readFile(file, "utf8");
  let json;
  try {
    json = JSON.parse(src);
  } catch (e) {
    err(file, `invalid JSON: ${e.message}`);
    return;
  }
  lintQuiz(file, json, topicIds);
}

async function main() {
  const topicFiles = globSync("src/content/topics/**/*.mdx");
  const pathFiles = globSync("src/content/paths/**/*.mdx");
  const quizFiles = globSync("src/content/topics/**/*.quiz.json");

  const topicIds = new Set(
    topicFiles.map((f) => f.split(/[\\/]/).pop().replace(/\.mdx$/, "")),
  );

  await Promise.all(topicFiles.map(lintTopic));
  await Promise.all(pathFiles.map(lintPath));
  await Promise.all(quizFiles.map((f) => lintQuizFile(f, topicIds)));

  const total = topicFiles.length + pathFiles.length + quizFiles.length;
  if (warnings.length) {
    console.warn("warnings:");
    for (const w of warnings) console.warn(`  - ${w}`);
  }
  if (errors.length) {
    console.error(`\nlint-content failed: ${errors.length} error(s) across ${total} file(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`lint-content OK (${total} files: ${topicFiles.length} topics, ${pathFiles.length} paths, ${quizFiles.length} quizzes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
