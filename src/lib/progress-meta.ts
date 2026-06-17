// Stable accessor over the build-time generated progress metadata.
//
// On-demand routes (/api/progress, /api/progress/me) import from here instead
// of astro:content so the worker bundle does NOT pull in the full content data
// store (~2.8 MiB). The generated module is produced by
// scripts/gen-progress-meta.mjs before build/dev/check.
import {
  pathsMeta,
  topicTitles,
  type ProgressPathMeta,
} from "./progress-meta.generated";

const pathsById = new Map<string, ProgressPathMeta>(
  pathsMeta.map((p) => [p.id, p]),
);

export function getPathMeta(pathId: string): ProgressPathMeta | undefined {
  return pathsById.get(pathId);
}

export function getTopicTitle(id: string): string | undefined {
  return topicTitles[id];
}

export type { ProgressPathMeta };
