import { getPathMeta } from "./progress-meta";

export interface ProgressPathSpec {
  pathId: string;
  /** Every topic in the path, in order (includes optional ones). */
  topicIds: string[];
  /** Only the topics that count toward completion. */
  requiredTopicIds: string[];
}

export async function getProgressPathSpec(
  pathId: string,
): Promise<ProgressPathSpec | null> {
  const meta = getPathMeta(pathId);
  if (!meta) return null;

  return {
    pathId: meta.id,
    topicIds: meta.topicIds,
    requiredTopicIds: meta.requiredTopicIds,
  };
}

export async function isValidProgressTarget(
  pathId: string,
  topicId: string,
): Promise<boolean> {
  const meta = getPathMeta(pathId);
  return Boolean(meta?.topicIds.includes(topicId));
}
