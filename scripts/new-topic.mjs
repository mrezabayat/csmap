#!/usr/bin/env node
/**
 * Scaffold a new topic MDX file with standardized frontmatter and headings.
 *
 * Usage:
 *   node scripts/new-topic.mjs <slug> \
 *     --category <c> --kind <k> --level <l> [--importance <i>] [--status <s>] \
 *     [--title "..."] [--summary "..."] [--force]
 *
 * Defaults: --kind concept --level beginner --importance important --status draft.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CATEGORIES = [
  "foundations",
  "hardware",
  "computer-architecture",
  "operating-systems",
  "programming-languages",
  "software-engineering",
  "data-and-databases",
  "networks-and-internet",
  "distributed-systems-and-cloud",
  "security-and-privacy",
  "human-computer-interaction",
  "graphics-and-media",
  "artificial-intelligence",
  "applications",
  "history-and-society",
  "operations-and-reliability",
  "mathematical-foundations",
  "low-latency-systems",
];
const KINDS = [
  "concept",
  "technology",
  "protocol",
  "language",
  "tool",
  "field",
  "person",
  "organization",
  "historical-event",
];
const LEVELS = ["beginner", "intermediate", "advanced"];
const STATUSES = ["stub", "draft", "reviewed"];
const IMPORTANCES = ["core", "important", "supplemental"];

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function die(msg) {
  console.error(`new-topic: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) die(`flag --${k} needs a value`);
      args.flags[k] = v;
      i += 1;
    } else if (a === "-h" || a === "--help") {
      args.flags.help = "1";
    } else {
      args._.push(a);
    }
  }
  return args;
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

const HELP = `Scaffold a new topic.

Usage:
  node scripts/new-topic.mjs <slug> --category <c> --kind <k> --level <l>
                              [--importance <i>] [--status <s>]
                              [--title "..."] [--summary "..."] [--force]

Categories:   ${CATEGORIES.join(", ")}
Kinds:        ${KINDS.join(", ")}
Levels:       ${LEVELS.join(", ")}
Importances:  ${IMPORTANCES.join(", ")}
Statuses:     ${STATUSES.join(", ")}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help || args._.length === 0) {
    console.log(HELP);
    process.exit(args._.length === 0 ? 1 : 0);
  }

  const slug = args._[0];
  if (!SLUG_RE.test(slug)) {
    die(`slug "${slug}" must be lowercase, alphanumeric, hyphenated, no leading/trailing dash.`);
  }

  const category = args.flags.category;
  if (!category) die("missing --category");
  if (!CATEGORIES.includes(category)) die(`unknown category "${category}"`);

  const kind = args.flags.kind ?? "concept";
  if (!KINDS.includes(kind)) die(`unknown kind "${kind}"`);

  const level = args.flags.level ?? "beginner";
  if (!LEVELS.includes(level)) die(`unknown level "${level}"`);

  const importance = args.flags.importance ?? "important";
  if (!IMPORTANCES.includes(importance)) die(`unknown importance "${importance}"`);

  const status = args.flags.status ?? "draft";
  if (!STATUSES.includes(status)) die(`unknown status "${status}"`);

  const title = args.flags.title ?? titleFromSlug(slug);
  const summary =
    args.flags.summary ?? `TODO: one-sentence summary of ${title} (max 280 chars).`;

  const today = new Date().toISOString().slice(0, 10);

  const outDir = join(REPO_ROOT, "src", "content", "topics", category);
  const outPath = join(outDir, `${slug}.mdx`);
  if (!args.flags.force) {
    try {
      await access(outPath, constants.F_OK);
      die(`refusing to overwrite ${outPath} (use --force)`);
    } catch {
      /* file does not exist — good */
    }
  }

  const body = `---
title: ${title}
category: ${category}
kind: ${kind}
summary: ${JSON.stringify(summary)}
level: ${level}
status: ${status}
importance: ${importance}
tags: []
prerequisites: []
related: []
partOf: []
nextSteps: []
updated: ${today}
---

## In simple terms

${status === "stub" ? "(Stub — not yet written. [Contribute](/contribute) to help fill this in.)" : "TODO."}

## More detail

## Why it matters

## Real-world examples

## Common misconceptions

## Learn next
`;

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, body);

  console.log(`Created ${outPath}`);
  console.log(`Edit the file and remove TODOs. Add cross-links with prerequisites/related/partOf/nextSteps as appropriate.`);
  console.log(`Run: npm run check && npm run build`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
