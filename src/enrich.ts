// The editor: one Workers AI call rewrites a batch of stories into neutral headlines and short
// summaries, and files each under a region, a topic and a priority.

import { REGIONS, TOPICS, type Region, type Settings, type Topic } from "./settings.ts";
import { truncate } from "./text.ts";

export interface EnrichArticle {
  source: string;
  title: string;
  summary: string;
  hint: string | null;
  publishedAt: number;
}

export interface EnrichInput {
  id: number;
  allowedRegions: Region[];
  articles: EnrichArticle[];
}

export interface EnrichOutput {
  id: number;
  headline: string;
  summary: string;
  region: Region;
  topic: Topic;
  priority: 1 | 2 | 3;
  breaking: boolean;
  newsworthy: boolean;
  /** ISO 639-1 code of the language the headline and summary are written in. */
  lang: string;
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", nl: "Dutch", fr: "French", de: "German" };

export function systemPrompt(settings: Settings): string {
  const L = settings.regionLabels;
  // "source" keeps every story in the language its reporters wrote it in.
  const lang =
    settings.language === "source"
      ? "the same language as the story's first listed article (do not translate)"
      : (LANGUAGE_NAMES[settings.language] ?? settings.language);
  return `You are the editor of a calm, factual news digest for readers living in ${L.local}, ${L.national}.
You receive numbered stories. Each story is one or more source articles about the same event, possibly in different languages.
For every story, return:
- headline: in ${lang}, at most 12 words. State what happened plainly. Neutral, specific, no clickbait, no questions, no exclamation marks, no teasers ("this is why…"), no sensational adjectives. Keep names of places and people.
- summary: in ${lang}, 1 or 2 sentences, at most 45 words, with the key facts (who, what, where, when, consequence). Only use facts from the articles. No opinion, no speculation.
- region: one of the story's allowed regions. "local" = ${L.local} and its surroundings; "national" = elsewhere in ${L.national}; "europe" = other European countries and the EU institutions; "world" = everywhere else. Choose by where the event happens or matters most.
- topic: one of ${TOPICS.join(", ")}.
- priority: "high" for major events with wide impact (deaths, disasters, major government decisions, strikes or disruptions that affect daily life, severe weather); "medium" for regular news; "low" for human interest, minor local items, celebrity news, curiosities.
- breaking: true only for an urgent event unfolding right now (attack, disaster, major accident, sudden resignation of a head of government). Usually false.
- lang: the ISO 639-1 code of the language you wrote the headline and summary in, e.g. "nl" or "en".
- newsworthy: false for advertising, promotions, quizzes, horoscopes, recipes, opinion columns, live-blog shells without news, and "what's on" listings. Otherwise true.
Return one entry per story, with the same id.`;
}

export function userPrompt(stories: EnrichInput[], now: number): string {
  return stories
    .map((s) => {
      const lines = s.articles.slice(0, 4).map((a) => {
        const age = Math.max(0, Math.round((now - a.publishedAt) / 3_600_000));
        const parts = [`- [${a.source}, ${age}h ago] ${a.title}`];
        if (a.summary) parts.push(truncate(a.summary, 320));
        if (a.hint) parts.push(`(${a.hint})`);
        return parts.join(" ");
      });
      return `Story ${s.id} (allowed regions: ${s.allowedRegions.join(", ")}; ${s.articles.length} article(s))\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          headline: { type: "string" },
          summary: { type: "string" },
          region: { type: "string", enum: [...REGIONS] },
          topic: { type: "string", enum: [...TOPICS] },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          breaking: { type: "boolean" },
          newsworthy: { type: "boolean" },
          lang: { type: "string" },
        },
        required: ["id", "headline", "summary", "region", "topic", "priority", "breaking", "newsworthy", "lang"],
      },
    },
  },
  required: ["stories"],
};

/** Pulls the JSON text out of either response shape Workers AI uses for chat models. */
export function responseText(res: unknown): string {
  const r = res as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const content = r?.choices?.[0]?.message?.content ?? r?.response;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") return JSON.stringify(content);
  throw new Error("Empty AI response");
}

/** Validates the model's answer against the inputs; drops anything malformed. */
export function parseEnrichment(text: string, inputs: EnrichInput[]): EnrichOutput[] {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
  const data = JSON.parse(cleaned) as { stories?: unknown[] } | unknown[];
  const list = Array.isArray(data) ? data : (data.stories ?? []);
  const byId = new Map(inputs.map((i) => [i.id, i]));
  const out: EnrichOutput[] = [];
  for (const raw of list) {
    const o = raw as Record<string, unknown>;
    const input = byId.get(Number(o.id));
    if (!input) continue;
    const headline = typeof o.headline === "string" ? o.headline.trim().replace(/[!]+$/, "") : "";
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    if (!headline) continue;
    const region = input.allowedRegions.includes(o.region as Region) ? (o.region as Region) : input.allowedRegions[0];
    const topic = TOPICS.includes(o.topic as Topic) ? (o.topic as Topic) : "other";
    const priority = o.priority === "high" ? 3 : o.priority === "medium" ? 2 : 1;
    out.push({
      id: input.id,
      headline: truncate(headline, 160),
      summary: truncate(summary, 600),
      region,
      topic,
      priority,
      breaking: o.breaking === true,
      newsworthy: o.newsworthy !== false,
      lang: typeof o.lang === "string" && /^[a-z]{2}$/i.test(o.lang.trim()) ? o.lang.trim().toLowerCase() : "",
    });
    byId.delete(input.id);
  }
  return out;
}

export async function enrichStories(ai: Ai, settings: Settings, inputs: EnrichInput[], now: number): Promise<EnrichOutput[]> {
  const res = await ai.run(settings.model as keyof AiModels, {
    messages: [
      { role: "system", content: systemPrompt(settings) },
      { role: "user", content: userPrompt(inputs, now) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "stories", schema: RESPONSE_SCHEMA, strict: true } },
    max_tokens: 220 * inputs.length + 200,
    temperature: 0.2,
    chat_template_kwargs: { enable_thinking: false },
  } as never);
  return parseEnrichment(responseText(res), inputs);
}
