export const CATEGORIES = [
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
] as const;

export type CategorySlug = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CategorySlug, string> = {
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

export const categoryLabel = (slug: CategorySlug): string =>
  CATEGORY_LABELS[slug];

export const isCategorySlug = (value: string): value is CategorySlug =>
  (CATEGORIES as readonly string[]).includes(value);
