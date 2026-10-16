// Ranking and the published snapshot. Pure functions, so they're easy to test.

import { similarity } from "./cluster.ts";
import { REGIONS, type Region, type Settings, type Topic } from "./settings.ts";
import { nextRefresh } from "./schedule.ts";

export type Priority = "high" | "medium" | "low";
export const PRIORITY_NAMES: Record<number, Priority> = { 3: "high", 2: "medium", 1: "low" };

/** A story row joined with its sources, as the snapshot builder needs it. */
export interface StoryInput {
  id: number;
  headline: string;
  summary: string;
  region: Region;
  topic: Topic;
  priority: 1 | 2 | 3;
  breaking: boolean;
  pinned: boolean;
  firstPublishedAt: number;
  lastPublishedAt: number;
  image: string | null;
  sources: { name: string; url: string }[];
  /** Embedding of the AI's English gist of the story, for the publish-time duplicate check. */
  vec?: Float32Array | null;
  /** ISO 639-1 language of headline and summary, when known. */
  lang?: string | null;
}

export interface PublicStory {
  id: number;
  headline: string;
  summary: string;
  lang: string | null;
  region: Region;
  topic: Topic;
  priority: Priority;
  breaking: boolean;
  publishedAt: string;
  updatedAt: string;
  image: string | null;
  sources: { name: string; url: string }[];
}

export interface Snapshot {
  version: 1;
  generatedAt: string;
  nextUpdateAt: string;
  site: { title: string; tagline: string; regions: { id: Region; label: string }[] };
  /** Every published story, best first. Each region holds at most its quota. */
  stories: PublicStory[];
}

const HOUR = 3_600_000;
/** "Breaking" only shows while the first report is this recent. */
export const BREAKING_HOURS = 6;
/** The page never marks more than this many stories important, or more than this many breaking. */
export const MAX_IMPORTANT = 4;
export const MAX_BREAKING = 2;
/** A story needs this many outlets reporting it before it can be marked important or breaking. */
export const MIN_FLAG_SOURCES = 2;

/** The editor called it breaking, it was first reported within the last few hours, and more than one outlet has it. */
export function isBreaking(s: Pick<StoryInput, "breaking" | "firstPublishedAt" | "sources">, now: number): boolean {
  return s.breaking && now - s.firstPublishedAt < BREAKING_HOURS * HOUR && s.sources.length >= MIN_FLAG_SOURCES;
}

export function scoreStory(s: StoryInput, now: number): number {
  const ageHours = Math.max(0, (now - s.lastPublishedAt) / HOUR);
  const priority = s.priority === 3 ? 30 : s.priority === 2 ? 15 : 0;
  const coverage = Math.min(Math.max(s.sources.length - 1, 0), 4) * 4;
  return priority + (isBreaking(s, now) ? 25 : 0) + coverage + (s.pinned ? 100 : 0) - ageHours * 1.2;
}

export function buildSnapshot(stories: StoryInput[], settings: Settings, now: number): Snapshot {
  const scored = stories
    .filter((s) => now - s.lastPublishedAt < settings.windowHours * HOUR || s.pinned)
    .filter((s) => !settings.excludedTopics.includes(s.topic))
    .map((s) => ({ s, score: scoreStory(s, now) }))
    .sort((a, b) => b.score - a.score || b.s.lastPublishedAt - a.s.lastPublishedAt);

  // Walk stories best-first. A story that reads like one already accepted is folded into it
  // (its sources are added), so the same event never shows twice.
  const used: Record<string, number> = {};
  const picked: { s: StoryInput; out: PublicStory }[] = [];
  const accepted: { vec: Float32Array; region: Region; out: PublicStory | null }[] = [];
  for (const { s } of scored) {
    const dupe = s.vec
      ? accepted.find((a) => (a.out || a.region === s.region) && similarity(a.vec, s.vec!) >= settings.mergeSimilarity)
      : undefined;
    if (dupe) {
      if (dupe.out) {
        for (const src of s.sources) if (!dupe.out.sources.some((x) => x.name === src.name)) dupe.out.sources.push(src);
        if (!dupe.out.image && s.image) dupe.out.image = s.image;
      }
      continue;
    }
    const quota = settings.quotas[s.region] ?? 0;
    let out: PublicStory | null = null;
    if ((used[s.region] ?? 0) < quota) {
      used[s.region] = (used[s.region] ?? 0) + 1;
      out = {
        id: s.id,
        headline: s.headline,
        summary: s.summary,
        lang: s.lang ?? null,
        region: s.region,
        topic: s.topic,
        priority: PRIORITY_NAMES[s.priority] ?? "low",
        breaking: false,
        publishedAt: new Date(s.firstPublishedAt).toISOString(),
        updatedAt: new Date(s.lastPublishedAt).toISOString(),
        image: s.image,
        sources: [...s.sources],
      };
      picked.push({ s, out });
    }
    if (s.vec) accepted.push({ vec: s.vec, region: s.region, out });
  }

  // Flags go on last, once duplicates have added their sources. Best stories first, and only a
  // handful: "high" in the snapshot means important on the page, so the rest of the editor's
  // "high" stories are published as "medium".
  let important = 0;
  let breaking = 0;
  for (const { s, out } of picked) {
    const corroborated = out.sources.length >= MIN_FLAG_SOURCES;
    const isImportant = important < MAX_IMPORTANT && corroborated && (s.priority === 3 || isBreaking({ ...s, sources: out.sources }, now));
    if (isImportant) important++;
    else if (out.priority === "high") out.priority = "medium";
    if (isImportant && breaking < MAX_BREAKING && isBreaking({ ...s, sources: out.sources }, now)) {
      out.priority = "high";
      out.breaking = true;
      breaking++;
    }
  }

  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    nextUpdateAt: new Date(nextRefresh(now)).toISOString(),
    site: {
      title: settings.siteTitle,
      tagline: settings.tagline,
      regions: REGIONS.map((id) => ({ id, label: settings.regionLabels[id] })),
    },
    stories: picked.map((p) => p.out),
  };
}
