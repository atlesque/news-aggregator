// Site-wide settings. Defaults live here; the admin stores overrides in the `settings` table.

export const REGIONS = ["local", "national", "europe", "world"] as const;
export type Region = (typeof REGIONS)[number];

export const TOPICS = [
  "politics",
  "economy",
  "society",
  "crime",
  "health",
  "science",
  "technology",
  "environment",
  "culture",
  "sports",
  "mobility",
  "weather",
  "other",
] as const;
export type Topic = (typeof TOPICS)[number];

export interface Settings {
  siteTitle: string;
  tagline: string;
  /** Labels shown for each region. `local` and `national` are where you live. */
  regionLabels: Record<Region, string>;
  /** How many stories each region gets on the front page and in the API. */
  quotas: Record<Region, number>;
  /** Language the AI writes headlines and summaries in: "source" keeps each story's original language, or an ISO 639-1 code to translate everything. */
  language: string;
  /** Workers AI text model for summaries and ranking. */
  model: string;
  /** Workers AI embedding model used to deduplicate. Multilingual, so a Dutch and an English report of one event match. */
  embeddingModel: string;
  /** Cosine similarity above which two articles count as the same story. */
  similarity: number;
  /** Second check at publish time, on the rewritten headlines. */
  mergeSimilarity: number;
  /** Stories older than this (by latest article) drop off the page. */
  windowHours: number;
  /** Ceiling on AI-rewritten stories per hourly run, to bound Workers AI usage. */
  maxEnrichPerRun: number;
  /** Topics the AI should leave out entirely. */
  excludedTopics: Topic[];
}

export const DEFAULT_SETTINGS: Settings = {
  siteTitle: "Atlesque News",
  tagline: "Bruges, Belgium, Europe and the world. Hourly, without the clickbait.",
  regionLabels: { local: "Bruges", national: "Belgium", europe: "Europe", world: "World" },
  quotas: { local: 8, national: 10, europe: 6, world: 8 },
  language: "source",
  model: "@cf/google/gemma-4-26b-a4b-it",
  embeddingModel: "@cf/baai/bge-m3",
  similarity: 0.75,
  mergeSimilarity: 0.78,
  windowHours: 36,
  maxEnrichPerRun: 40,
  excludedTopics: [],
};

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const merged = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const row of results) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      merged[row.key] = JSON.parse(row.value);
    } catch {
      // Ignore a corrupt override and keep the default.
    }
  }
  return merged as unknown as Settings;
}

/** Validates a partial update from the admin. Throws with a readable message. */
export function validateSettings(input: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {};
  const s = (k: string, max = 200) => {
    const v = input[k];
    if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`${k} must be a non-empty string`);
    return v.trim();
  };
  const n = (k: string, min: number, max: number) => {
    const v = Number(input[k]);
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${k} must be between ${min} and ${max}`);
    return v;
  };
  if ("siteTitle" in input) out.siteTitle = s("siteTitle", 80);
  if ("tagline" in input) out.tagline = s("tagline", 200);
  if ("language" in input) out.language = s("language", 20);
  if ("model" in input) out.model = s("model", 120);
  if ("embeddingModel" in input) out.embeddingModel = s("embeddingModel", 120);
  if ("similarity" in input) out.similarity = n("similarity", 0.5, 0.99);
  if ("mergeSimilarity" in input) out.mergeSimilarity = n("mergeSimilarity", 0.5, 0.99);
  if ("windowHours" in input) out.windowHours = Math.round(n("windowHours", 6, 168));
  if ("maxEnrichPerRun" in input) out.maxEnrichPerRun = Math.round(n("maxEnrichPerRun", 0, 200));
  if ("regionLabels" in input) {
    const v = input.regionLabels as Record<string, unknown>;
    out.regionLabels = Object.fromEntries(
      REGIONS.map((r) => {
        const label = v?.[r];
        if (typeof label !== "string" || !label.trim()) throw new Error(`regionLabels.${r} is required`);
        return [r, label.trim().slice(0, 40)];
      }),
    ) as Record<Region, string>;
  }
  if ("quotas" in input) {
    const v = input.quotas as Record<string, unknown>;
    out.quotas = Object.fromEntries(
      REGIONS.map((r) => {
        const q = Number(v?.[r]);
        if (!Number.isInteger(q) || q < 0 || q > 50) throw new Error(`quotas.${r} must be 0–50`);
        return [r, q];
      }),
    ) as Record<Region, number>;
  }
  if ("excludedTopics" in input) {
    const v = input.excludedTopics;
    if (!Array.isArray(v) || v.some((t) => !TOPICS.includes(t as Topic))) throw new Error("excludedTopics has an unknown topic");
    out.excludedTopics = v as Topic[];
  }
  return out;
}

export async function saveSettings(db: D1Database, patch: Partial<Settings>): Promise<void> {
  const stmts = Object.entries(patch).map(([k, v]) =>
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, JSON.stringify(v)),
  );
  if (stmts.length) await db.batch(stmts);
}
