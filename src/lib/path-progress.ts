import { loadGraph } from "./graph";

export interface ProgressPathSpec {
  pathId: string;
  topicIds: string[];
}

export async function getProgressPathSpec(
  pathId: string,
): Promise<ProgressPathSpec | null> {
  const { paths } = await loadGraph();
  const path = paths.find((p) => p.id === pathId);
  if (!path) return null;

  return {
    pathId: path.id,
    topicIds: path.data.topics.map((topic) =>
      typeof topic === "string" ? topic : topic.id,
    ),
  };
}

export async function isValidProgressTarget(
  pathId: string,
  topicId: string,
): Promise<boolean> {
  const spec = await getProgressPathSpec(pathId);
  return Boolean(spec?.topicIds.includes(topicId));
}
