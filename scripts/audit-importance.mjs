#!/usr/bin/env node
/**
 * Per-category report: how complete is each Ring (core / important / supplemental)?
 *
 * Driven by the canonical Core lists per category (mirrors the plan).
 * Cross-listed topics live in their primary category only; the audit
 * looks for each Core slug in the topic registry regardless of where
 * its file lives.
 */

import { readFile } from "node:fs/promises";
import { globSync } from "node:fs";
import { basename } from "node:path";

const CATEGORY_TITLES = {
  foundations: "Foundations",
  hardware: "Hardware",
  "computer-architecture": "Computer Architecture",
  "operating-systems": "Operating Systems",
  "programming-languages": "Programming Languages",
  "software-engineering": "Software Engineering",
  "data-and-databases": "Data and Databases",
  "networks-and-internet": "Networks and Internet",
  "distributed-systems-and-cloud": "Distributed Systems and Cloud",
  "security-and-privacy": "Security and Privacy",
  "human-computer-interaction": "Human-Computer Interaction",
  "graphics-and-media": "Graphics and Media",
  "artificial-intelligence": "Artificial Intelligence",
  applications: "Applications",
  "history-and-society": "History and Society",
  "operations-and-reliability": "Operations and Reliability",
  "mathematical-foundations": "Mathematical Foundations",
  "low-latency-systems": "Low-Latency Systems",
};

// Core (Ring 1) lists per category — mirrors docs/content-roadmap.md.
// A slug may appear under more than one category if it is cross-listed.
const CORE = {
  foundations: ["bits", "binary-numbers", "boolean-logic", "algorithms", "data-structure", "big-o", "recursion"],
  hardware: ["transistor", "logic-gates", "cpu", "memory", "storage", "gpu", "bus"],
  "computer-architecture": ["instruction-set", "cpu-pipeline", "cache", "register", "virtual-memory"],
  "operating-systems": ["operating-system", "process", "thread", "scheduler", "virtual-memory", "kernel", "file-system"],
  "programming-languages": ["programming-language", "compiler", "interpreter", "type-system", "garbage-collection"],
  "software-engineering": ["version-control", "git", "testing", "code-review", "ci-cd", "design-pattern"],
  "data-and-databases": ["database", "sql", "relational-model", "indexing", "transaction-acid", "normalization"],
  "networks-and-internet": ["packet", "router", "ip-address", "tcp", "udp", "dns", "http", "tls"],
  "distributed-systems-and-cloud": ["distributed-system", "consensus", "replication", "sharding", "microservices", "container"],
  "security-and-privacy": ["cryptography", "public-key-cryptography", "authentication", "authorization", "password-hashing", "tls"],
  "human-computer-interaction": ["user-interface", "ux", "accessibility", "gui", "command-line-interface"],
  "graphics-and-media": ["pixel", "rasterization", "color-space", "image-format", "codec"],
  "artificial-intelligence": ["machine-learning", "neural-network", "supervised-learning", "training-and-inference", "transformer", "large-language-model"],
  applications: ["web-browser", "mobile-app", "embedded-system", "game-engine"],
  "history-and-society": ["alan-turing", "turing-machine", "history-of-computing", "ada-lovelace", "internet-history"],
  "operations-and-reliability": ["deployment", "monitoring", "logging", "incident-response", "sre"],
  "mathematical-foundations": ["linear-algebra", "probability-statistics", "calculus-basics", "set-theory"],
  "low-latency-systems": ["cache-line-alignment", "memory-pool", "lock-free-programming"],
};

async function main() {
  const topicFiles = globSync("src/content/topics/**/*.mdx");
  const slugs = new Set(topicFiles.map((f) => basename(f).replace(/\.mdx$/, "")));

  // Also classify each slug by its importance to report Ring 2/3 progress lazily.
  const importanceOf = new Map();
  for (const file of topicFiles) {
    const src = await readFile(file, "utf8");
    const m = src.match(/^importance:\s*(\w+)/m);
    importanceOf.set(basename(file).replace(/\.mdx$/, ""), m ? m[1] : "important");
  }

  let ring1Complete = true;
  let totalCorePresent = 0;
  let totalCoreNeeded = 0;

  for (const [cat, list] of Object.entries(CORE)) {
    const title = CATEGORY_TITLES[cat];
    const missing = list.filter((s) => !slugs.has(s));
    const present = list.length - missing.length;
    totalCorePresent += present;
    totalCoreNeeded += list.length;
    const ok = missing.length === 0;
    if (!ok) ring1Complete = false;
    const status = ok ? "OK" : "INCOMPLETE";
    console.log(`${title}`);
    console.log(`  core: ${present} / ${list.length}    Ring 1: ${status}`);
    if (missing.length > 0) {
      console.log(`  missing: ${missing.join(", ")}`);
    }
  }

  console.log("\nSummary");
  console.log(`  Core overall: ${totalCorePresent} / ${totalCoreNeeded}`);
  const importantCount = [...importanceOf.values()].filter((v) => v === "important").length;
  const coreCount = [...importanceOf.values()].filter((v) => v === "core").length;
  const supplementalCount = [...importanceOf.values()].filter((v) => v === "supplemental").length;
  console.log(`  By importance: core=${coreCount} important=${importantCount} supplemental=${supplementalCount}`);
  console.log(`  Ring 1: ${ring1Complete ? "COMPLETE" : "INCOMPLETE"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
