// The hourly refresh, as a Cloudflare Workflow. Each piece of work is its own step:
//   fetch (one step per source) → cluster (batches of new articles) → enrich (batches of stories) → publish.
// Steps run in separate invocations with their own CPU budget and retry independently, so a
// slow feed or a failed AI call never sinks the whole run, and the free plan's 10 ms CPU
// limit per invocation is respected.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { assign, fromBlob, normalize, toBlob, type Candidate } from "./cluster.ts";
import { enrichStories, type EnrichInput } from "./enrich.ts";
import { buildSnapshot, type StoryInput } from "./rank.ts";
import { loadSettings, REGIONS, type Region, type Settings } from "./settings.ts";
import { getModule } from "./sources/index.ts";
import { list, num } from "./sources/types.ts";
import { canonicalUrl, matchesAny, sha256Hex, truncate } from "./text.ts";

const HOUR = 3_600_000;
const CLUSTER_BATCH = 16;
const ENRICH_BATCH = 8;
/** New articles are only compared with stories this recent. */
const CLUSTER_WINDOW_HOURS = 48;
/** A story that gained articles is re-written at most this often. */
const REENRICH_AFTER_HOURS = 2;
/** Articles and stories older than this are deleted. */
const RETENTION_DAYS = 7;

export interface RefreshParams {
  trigger: "cron" | "admin";
}

interface SourceRow {
  id: number;
  module: string;
  name: string;
  config: string;
  regions: string;
  enabled: number;
  etag: string | null;
  last_modified: string | null;
}

export class RefreshWorkflow extends WorkflowEntrypoint<Env, RefreshParams> {
  async run(event: WorkflowEvent<RefreshParams>, step: WorkflowStep) {
    const runId = event.instanceId;
    const stats = { sources: 0, failedSources: 0, newArticles: 0, clustered: 0, newStories: 0, enriched: 0, published: 0 };

    await step.do("start", async () => {
      await this.env.DB.prepare("INSERT OR IGNORE INTO runs (id, trigger, started_at, status) VALUES (?, ?, ?, 'running')")
        .bind(runId, event.payload?.trigger ?? "cron", Date.now())
        .run();
    });

    try {
      const sourceIds = await step.do("list sources", async () => {
        const { results } = await this.env.DB.prepare("SELECT id FROM sources WHERE enabled = 1 ORDER BY id").all<{ id: number }>();
        return results.map((r) => r.id);
      });

      for (const id of sourceIds) {
        // A failing feed is recorded on the source and skipped; it must not fail the run.
        const result = await step.do(`fetch source ${id}`, { retries: { limit: 1, delay: "10 seconds" }, timeout: "60 seconds" }, () =>
          fetchSource(this.env.DB, id, Date.now()),
        );
        stats.sources++;
        if (result.error) stats.failedSources++;
        stats.newArticles += result.added;
      }

      const settings = await step.do("load settings", () => loadSettings(this.env.DB));

      for (let i = 0; i < 40; i++) {
        const r = await step.do(`cluster batch ${i}`, { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } }, () =>
          clusterBatch(this.env, settings, Date.now()),
        );
        stats.clustered += r.clustered;
        stats.newStories += r.newStories;
        if (r.clustered < CLUSTER_BATCH) break;
      }

      const maxBatches = Math.ceil(settings.maxEnrichPerRun / ENRICH_BATCH) + 2;
      for (let i = 0; i < maxBatches && stats.enriched < settings.maxEnrichPerRun; i++) {
        const limit = Math.min(ENRICH_BATCH, settings.maxEnrichPerRun - stats.enriched);
        const r = await step.do(`enrich batch ${i}`, { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } }, () =>
          enrichBatch(this.env, settings, limit, Date.now()),
        );
        stats.enriched += r.enriched;
        if (r.picked < limit) break;
      }

      stats.published = await step.do("publish", () => publish(this.env.DB, Date.now()));
      await step.do("prune", () => prune(this.env.DB, Date.now()));

      await step.do("finish", async () => {
        await this.env.DB.prepare("UPDATE runs SET finished_at = ?, status = 'ok', stats = ? WHERE id = ?")
          .bind(Date.now(), JSON.stringify(stats), runId)
          .run();
      });
      return stats;
    } catch (err) {
      await step.do("record failure", async () => {
        await this.env.DB.prepare("UPDATE runs SET finished_at = ?, status = 'failed', stats = ?, error = ? WHERE id = ?")
          .bind(Date.now(), JSON.stringify(stats), truncate(String(err), 500), runId)
          .run();
      });
      throw err;
    }
  }
}

/** Fetches one source and stores its new articles. Never throws: errors are recorded on the source. */
export async function fetchSource(db: D1Database, id: number, now: number): Promise<{ added: number; error: string | null }> {
  const src = await db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first<SourceRow>();
  if (!src || !src.enabled) return { added: 0, error: null };
  const mod = getModule(src.module);
  try {
    if (!mod) throw new Error(`Unknown module "${src.module}"`);
    const config = JSON.parse(src.config) as Record<string, unknown>;
    const result = await mod.fetch(config, { etag: src.etag, lastModified: src.last_modified });

    const maxAge = num(config, "maxAgeHours", 36) * HOUR;
    const include = list(config, "includeKeywords");
    const exclude = list(config, "excludeKeywords");
    const items = result.items
      .map((i) => ({ ...i, publishedAt: Math.min(i.publishedAt ?? now, now) }))
      .filter((i) => now - i.publishedAt <= maxAge)
      .filter((i) => !include.length || matchesAny(`${i.title} ${i.summary}`, include))
      .filter((i) => !exclude.length || !matchesAny(`${i.title} ${i.summary}`, exclude))
      .slice(0, num(config, "maxItems", 40));

    let added = 0;
    if (items.length) {
      const rows = await Promise.all(
        items.map(async (i) => {
          const url = canonicalUrl(i.url);
          return { ...i, url, id: (await sha256Hex(url)).slice(0, 32) };
        }),
      );
      const results = await db.batch(
        rows.map((r) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO articles (id, source_id, url, title, summary, image, hint, published_at, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(r.id, src.id, r.url, truncate(r.title, 300), truncate(r.summary, 1000), r.image, r.hint, r.publishedAt, now),
        ),
      );
      added = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    }

    await db
      .prepare(
        `UPDATE sources SET last_fetch_at = ?, last_status = ?, last_error = NULL, last_new = ?, etag = ?, last_modified = ? WHERE id = ?`,
      )
      .bind(now, result.notModified ? "not modified" : `ok (${result.items.length} items)`, added, result.etag ?? null, result.lastModified ?? null, id)
      .run();
    return { added, error: null };
  } catch (err) {
    const message = truncate(err instanceof Error ? err.message : String(err), 300);
    await db.prepare("UPDATE sources SET last_fetch_at = ?, last_status = 'error', last_error = ?, last_new = 0 WHERE id = ?").bind(now, message, id).run();
    return { added: 0, error: message };
  }
}

async function embed(env: Env, settings: Settings, texts: string[]): Promise<Float32Array[]> {
  const res = (await env.AI.run(settings.embeddingModel as keyof AiModels, { text: texts.map((t) => truncate(t, 600)) } as never)) as {
    data?: number[][];
  };
  if (!res.data || res.data.length !== texts.length) throw new Error("Embedding model returned no vectors");
  return res.data.map(normalize);
}

/** Embeds up to CLUSTER_BATCH unclustered articles and files each under a story. */
export async function clusterBatch(env: Env, settings: Settings, now: number): Promise<{ clustered: number; newStories: number }> {
  const db = env.DB;
  const { results: articles } = await db
    .prepare(
      `SELECT id, title, summary, published_at FROM articles WHERE story_id IS NULL ORDER BY published_at DESC LIMIT ${CLUSTER_BATCH}`,
    )
    .all<{ id: string; title: string; summary: string; published_at: number }>();
  if (!articles.length) return { clustered: 0, newStories: 0 };

  const vectors = await embed(env, settings, articles.map((a) => `${a.title}. ${a.summary}`));

  const { results: recent } = await db
    .prepare("SELECT id, centroid FROM stories WHERE last_published_at > ? AND centroid IS NOT NULL")
    .bind(now - CLUSTER_WINDOW_HOURS * HOUR)
    .all<{ id: number; centroid: ArrayBuffer }>();
  const candidates: Candidate[] = [];
  for (const r of recent) {
    const vec = fromBlob(r.centroid);
    if (vec) candidates.push({ storyId: r.id, vec });
  }

  const assignments = assign(vectors, candidates, settings.similarity);

  // Create one story per new group, centred on its first article.
  const groupStory = new Map<number, number>();
  let newStories = 0;
  for (let i = 0; i < articles.length; i++) {
    const a = assignments[i];
    if (a.kind !== "new" || groupStory.has(a.group)) continue;
    const row = await db
      .prepare(
        `INSERT INTO stories (created_at, updated_at, first_published_at, last_published_at, centroid)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(now, now, articles[i].published_at, articles[i].published_at, toBlob(vectors[i]))
      .first<{ id: number }>();
    groupStory.set(a.group, row!.id);
    newStories++;
  }

  const touched = new Set<number>();
  const stmts = articles.map((art, i) => {
    const a = assignments[i];
    const storyId = a.kind === "existing" ? a.storyId : groupStory.get(a.group)!;
    touched.add(storyId);
    return db.prepare("UPDATE articles SET story_id = ? WHERE id = ?").bind(storyId, art.id);
  });
  for (const storyId of touched) {
    stmts.push(
      db
        .prepare(
          `UPDATE stories SET
             dirty = 1, updated_at = ?,
             article_count = (SELECT COUNT(*) FROM articles WHERE story_id = stories.id),
             source_count = (SELECT COUNT(DISTINCT source_id) FROM articles WHERE story_id = stories.id),
             first_published_at = (SELECT MIN(published_at) FROM articles WHERE story_id = stories.id),
             last_published_at = (SELECT MAX(published_at) FROM articles WHERE story_id = stories.id),
             image = COALESCE(image, (SELECT image FROM articles WHERE story_id = stories.id AND image IS NOT NULL LIMIT 1))
           WHERE id = ?`,
        )
        .bind(now, storyId),
    );
  }
  await db.batch(stmts);
  return { clustered: articles.length, newStories };
}

/** Rewrites up to `limit` stories that are new, or that gained articles a while after their last rewrite. */
export async function enrichBatch(env: Env, settings: Settings, limit: number, now: number): Promise<{ picked: number; enriched: number }> {
  const db = env.DB;
  const { results: stories } = await db
    .prepare(
      `SELECT id FROM stories
       WHERE dirty = 1 AND last_published_at > ? AND (enriched_at IS NULL OR enriched_at < ?)
       ORDER BY enriched_at IS NOT NULL, source_count DESC, last_published_at DESC
       LIMIT ?`,
    )
    .bind(now - settings.windowHours * HOUR, now - REENRICH_AFTER_HOURS * HOUR, limit)
    .all<{ id: number }>();
  if (!stories.length) return { picked: 0, enriched: 0 };

  const ids = stories.map((s) => s.id);
  const { results: rows } = await db
    .prepare(
      `SELECT a.story_id, a.title, a.summary, a.hint, a.published_at, s.name AS source, s.regions
       FROM articles a JOIN sources s ON s.id = a.source_id
       WHERE a.story_id IN (${ids.map(() => "?").join(",")})
       ORDER BY a.published_at DESC`,
    )
    .bind(...ids)
    .all<{ story_id: number; title: string; summary: string; hint: string | null; published_at: number; source: string; regions: string }>();

  const inputs: EnrichInput[] = ids.map((id) => {
    const arts = rows.filter((r) => r.story_id === id);
    const allowed = new Set<Region>();
    for (const a of arts) for (const r of JSON.parse(a.regions) as Region[]) if (REGIONS.includes(r)) allowed.add(r);
    return {
      id,
      allowedRegions: allowed.size ? REGIONS.filter((r) => allowed.has(r)) : ["world"],
      articles: arts.map((a) => ({ source: a.source, title: a.title, summary: a.summary, hint: a.hint, publishedAt: a.published_at })),
    };
  });

  const outputs = await enrichStories(env.AI, settings, inputs, now);
  // Rewritten stories are all in one language and style, which makes duplicates that slipped
  // past article clustering easy to spot at publish time.
  const vecs = outputs.length ? await embed(env, settings, outputs.map((o) => `${o.headline}. ${o.summary}`)) : [];
  const stmts = outputs.map((o, i) =>
    db
      .prepare(
        `UPDATE stories SET headline = ?, summary = ?, region = ?, topic = ?, priority = ?, breaking = ?, newsworthy = ?,
           dirty = 0, enriched_at = ?, ai_model = ?, headline_vec = ? WHERE id = ?`,
      )
      .bind(o.headline, o.summary, o.region, o.topic, o.priority, o.breaking ? 1 : 0, o.newsworthy ? 1 : 0, now, settings.model, toBlob(vecs[i]), o.id),
  );
  // Stories the model skipped stay dirty and are retried in a later run, not this one.
  const skipped = ids.filter((id) => !outputs.some((o) => o.id === id));
  for (const id of skipped) stmts.push(db.prepare("UPDATE stories SET enriched_at = ? WHERE id = ?").bind(now, id));
  if (stmts.length) await db.batch(stmts);
  return { picked: ids.length, enriched: outputs.length };
}

/** Loads publishable stories with their sources, for the snapshot. */
export async function loadStoriesForSnapshot(db: D1Database, settings: Settings, now: number): Promise<StoryInput[]> {
  const since = now - Math.max(settings.windowHours, 48) * HOUR;
  const { results: stories } = await db
    .prepare(
      `SELECT id, headline, summary, region, topic, priority, breaking, pinned, first_published_at, last_published_at, image, headline_vec
       FROM stories
       WHERE headline IS NOT NULL AND newsworthy = 1 AND hidden = 0 AND (last_published_at > ? OR pinned = 1)`,
    )
    .bind(since)
    .all<{
      id: number; headline: string; summary: string; region: Region; topic: StoryInput["topic"]; priority: 1 | 2 | 3;
      breaking: number; pinned: number; first_published_at: number; last_published_at: number; image: string | null;
      headline_vec: ArrayBuffer | null;
    }>();
  if (!stories.length) return [];

  const { results: sources } = await db
    .prepare(
      `SELECT a.story_id, s.name, a.url, a.hint FROM articles a JOIN sources s ON s.id = a.source_id
       WHERE a.story_id IN (SELECT id FROM stories WHERE headline IS NOT NULL AND (last_published_at > ? OR pinned = 1))
       ORDER BY a.published_at ASC`,
    )
    .bind(since)
    .all<{ story_id: number; name: string; url: string; hint: string | null }>();
  const byStory = new Map<number, { name: string; url: string }[]>();
  for (const s of sources) {
    const arr = byStory.get(s.story_id) ?? [];
    // Credit the actual outlet for aggregator sources like Google News.
    const name = s.hint?.startsWith("Publisher: ") ? s.hint.slice(11) : s.name;
    if (!arr.some((x) => x.name === name)) arr.push({ name, url: s.url });
    byStory.set(s.story_id, arr);
  }

  return stories.map((s) => ({
    id: s.id,
    headline: s.headline,
    summary: s.summary ?? "",
    region: s.region,
    topic: s.topic,
    priority: s.priority,
    breaking: !!s.breaking,
    pinned: !!s.pinned,
    firstPublishedAt: s.first_published_at,
    lastPublishedAt: s.last_published_at,
    image: s.image,
    sources: byStory.get(s.id) ?? [],
    vec: fromBlob(s.headline_vec),
  }));
}

/** Builds and stores the front-page snapshot. Returns the number of stories in it. */
export async function publish(db: D1Database, now: number): Promise<number> {
  const settings = await loadSettings(db);
  const snapshot = buildSnapshot(await loadStoriesForSnapshot(db, settings, now), settings, now);
  await db.prepare("INSERT INTO snapshots (created_at, json) VALUES (?, ?)").bind(now, JSON.stringify(snapshot)).run();
  return snapshot.stories.length;
}

export async function prune(db: D1Database, now: number): Promise<void> {
  const cutoff = now - RETENTION_DAYS * 24 * HOUR;
  await db.batch([
    db.prepare("DELETE FROM articles WHERE published_at < ? AND story_id IN (SELECT id FROM stories WHERE last_published_at < ? AND pinned = 0)").bind(cutoff, cutoff),
    db.prepare("DELETE FROM stories WHERE last_published_at < ? AND pinned = 0").bind(cutoff),
    db.prepare("DELETE FROM articles WHERE published_at < ? AND story_id IS NULL").bind(cutoff),
    db.prepare("DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 48)"),
    db.prepare("DELETE FROM runs WHERE started_at < ?").bind(now - 30 * 24 * HOUR),
  ]);
}
