// Filtering and output formats for the keyed API. Pure, so they're easy to test.

import type { PublicStory, Snapshot } from "./rank.ts";
import { REGIONS, TOPICS } from "./settings.ts";
import { asciiFold, truncate } from "./text.ts";

export type Format = "json" | "compact" | "rss" | "text";

export interface ApiQuery {
  regions: string[];
  topics: string[];
  minPriority: 1 | 2 | 3;
  breakingOnly: boolean;
  limit: number;
  summaries: boolean;
  maxSummary: number;
  ascii: boolean;
  format: Format;
}

const PRIORITY_RANK = { low: 1, medium: 2, high: 3 } as const;

export function parseQuery(params: URLSearchParams, defaultFormat: Format = "json"): ApiQuery {
  const csv = (k: string) =>
    (params.get(k) ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  const int = (k: string, def: number, min: number, max: number) => {
    const v = Number.parseInt(params.get(k) ?? "", 10);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  };
  const bool = (k: string, def: boolean) => {
    const v = params.get(k);
    return v === null ? def : v === "1" || v === "true" || v === "yes";
  };
  const fmt = params.get("format");
  const minP = (params.get("minPriority") ?? params.get("min_priority") ?? "low").toLowerCase();
  return {
    regions: csv("region").filter((r) => (REGIONS as readonly string[]).includes(r)),
    topics: csv("topic").filter((t) => (TOPICS as readonly string[]).includes(t)),
    minPriority: PRIORITY_RANK[minP as keyof typeof PRIORITY_RANK] ?? 1,
    breakingOnly: bool("breaking", false),
    limit: int("limit", 20, 1, 100),
    summaries: bool("summary", true),
    maxSummary: int("maxSummary", 400, 40, 2000),
    ascii: bool("ascii", false),
    format: fmt === "compact" || fmt === "rss" || fmt === "text" || fmt === "json" ? fmt : defaultFormat,
  };
}

/** A stable cache key for the query, so identical requests share one cached response. */
export function queryKey(q: ApiQuery): string {
  return [
    q.format,
    q.regions.slice().sort().join("+") || "all",
    q.topics.slice().sort().join("+") || "all",
    q.minPriority,
    q.breakingOnly ? 1 : 0,
    q.limit,
    q.summaries ? 1 : 0,
    q.maxSummary,
    q.ascii ? 1 : 0,
  ].join("/");
}

export function selectStories(snapshot: Snapshot, q: ApiQuery): PublicStory[] {
  const fold = q.ascii ? asciiFold : (s: string) => s;
  return snapshot.stories
    .filter((s) => !q.regions.length || q.regions.includes(s.region))
    .filter((s) => !q.topics.length || q.topics.includes(s.topic))
    .filter((s) => PRIORITY_RANK[s.priority] >= q.minPriority)
    .filter((s) => !q.breakingOnly || s.breaking)
    .slice(0, q.limit)
    .map((s) => ({
      ...s,
      headline: fold(s.headline),
      summary: q.summaries ? fold(truncate(s.summary, q.maxSummary)) : "",
      sources: s.sources.map((src) => ({ ...src, name: fold(src.name) })),
    }));
}

export function renderJson(snapshot: Snapshot, stories: PublicStory[]): string {
  return JSON.stringify({
    generatedAt: snapshot.generatedAt,
    nextUpdateAt: snapshot.nextUpdateAt,
    count: stories.length,
    stories,
  });
}

/**
 * Short keys and no URLs, for microcontrollers with little RAM:
 * t = generated (unix s), n = next update (unix s), i = items with
 * h headline, s summary, r region, c topic, p priority (3 high … 1 low), b breaking (0/1),
 * a published (unix s), o outlet (first source).
 */
export function renderCompact(snapshot: Snapshot, stories: PublicStory[]): string {
  const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  return JSON.stringify({
    t: unix(snapshot.generatedAt),
    n: unix(snapshot.nextUpdateAt),
    i: stories.map((s) => {
      const item: Record<string, string | number> = {
        h: s.headline,
        r: s.region,
        c: s.topic,
        p: PRIORITY_RANK[s.priority],
        b: s.breaking ? 1 : 0,
        a: unix(s.updatedAt),
        o: s.sources[0]?.name ?? "",
      };
      if (s.summary) item.s = s.summary;
      return item;
    }),
  });
}

export function renderText(snapshot: Snapshot, stories: PublicStory[]): string {
  const lines = [`${snapshot.site.title} - ${snapshot.generatedAt}`, ""];
  for (const s of stories) {
    const flag = s.breaking ? "BREAKING " : s.priority === "high" ? "* " : "";
    lines.push(`${flag}${s.headline} [${s.region}/${s.topic}]`);
    if (s.summary) lines.push(s.summary);
    lines.push("");
  }
  return lines.join("\n");
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderRss(snapshot: Snapshot, stories: PublicStory[], siteUrl: string, selfUrl: string): string {
  const label = Object.fromEntries(snapshot.site.regions.map((r) => [r.id, r.label]));
  const items = stories.map((s) => {
    const sources = s.sources.map((src) => `<a href="${xml(src.url)}">${xml(src.name)}</a>`).join(", ");
    const body = `<p>${xml(s.summary)}</p><p>Sources: ${sources}</p>`;
    return [
      "<item>",
      `<title>${xml((s.breaking ? "BREAKING: " : "") + s.headline)}</title>`,
      `<link>${xml(s.sources[0]?.url ?? siteUrl)}</link>`,
      `<guid isPermaLink="false">${xml(`${siteUrl}/#story-${s.id}`)}</guid>`,
      `<pubDate>${new Date(s.updatedAt).toUTCString()}</pubDate>`,
      `<category>${xml(label[s.region] ?? s.region)}</category>`,
      `<category>${xml(s.topic)}</category>`,
      `<description>${xml(body)}</description>`,
      "</item>",
    ].join("");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    `<title>${xml(snapshot.site.title)}</title>`,
    `<link>${xml(siteUrl)}</link>`,
    `<description>${xml(snapshot.site.tagline)}</description>`,
    `<atom:link href="${xml(selfUrl)}" rel="self" type="application/rss+xml"/>`,
    `<lastBuildDate>${new Date(snapshot.generatedAt).toUTCString()}</lastBuildDate>`,
    "<ttl>60</ttl>",
    ...items,
    "</channel></rss>",
  ].join("\n");
}
