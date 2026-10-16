// The stored side of the refresh: knowing what was already ingested, giving each story a
// picture in R2, and the rolling window that deletes everything older than RETENTION_DAYS.
// Kept apart from the Workflow class so tests can run it against a plain SQLite database.

import { findStoryImage, imageKey, keyDay, MIN_WIDTH } from "./images.ts";
import type { Settings } from "./settings.ts";
import { dedupKey } from "./text.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Stories per image step: each can use up to 8 subrequests (a step may make 50), and page parsing stays inside the CPU budget. */
export const IMAGE_BATCH = 3;

/**
 * The rolling window: stories (with their articles, summaries and pictures) whose newest article
 * is older than this are deleted, and feed items older than this are never ingested, so a
 * deleted article can't come back as new.
 */
export const RETENTION_DAYS = 3;

/**
 * Drops items already ingested: same canonical URL, or same outlet and headline under another
 * URL (from any source, so two searches finding one article store it once). Also drops repeats
 * within the batch itself.
 */
export async function dropIngested<T extends { id: string; key: string | null }>(db: D1Database, rows: T[]): Promise<T[]> {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  // D1 allows 100 bound parameters per query.
  for (let i = 0; i < rows.length; i += 45) {
    const chunk = rows.slice(i, i + 45);
    const keys = chunk.map((r) => r.key).filter((k): k is string => !!k);
    const { results } = await db
      .prepare(
        `SELECT id, dedup_key FROM articles WHERE id IN (${chunk.map(() => "?").join(",")})` +
          (keys.length ? ` OR dedup_key IN (${keys.map(() => "?").join(",")})` : ""),
      )
      .bind(...chunk.map((r) => r.id), ...keys)
      .all<{ id: string; dedup_key: string | null }>();
    for (const r of results) {
      seenIds.add(r.id);
      if (r.dedup_key) seenKeys.add(r.dedup_key);
    }
  }
  const out: T[] = [];
  for (const r of rows) {
    if (seenIds.has(r.id) || (r.key && seenKeys.has(r.key))) continue;
    seenIds.add(r.id);
    if (r.key) seenKeys.add(r.key);
    out.push(r);
  }
  return out;
}

/** Fills in dedup_key for rows stored before it existed. A no-op once they all have one. */
export async function backfillDedupKeys(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, url, title FROM articles WHERE dedup_key IS NULL ORDER BY fetched_at DESC LIMIT 1000")
    .all<{ id: string; url: string; title: string }>();
  // Rows whose headline is too short for a key get "" so they aren't picked up again.
  const stmts = results.map((r) => db.prepare("UPDATE articles SET dedup_key = ? WHERE id = ?").bind(dedupKey(r.url, r.title) ?? "", r.id));
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

/**
 * Gives up to IMAGE_BATCH published-worthy stories a picture in R2: stories without one, and
 * stories whose picture is small, once new articles have joined them (each article may bring a
 * better picture). A story where nothing is found keeps image_key NULL and is tried again when
 * its next article arrives; the page then shows its placeholder.
 */
export async function imageBatch(env: Env, settings: Settings, now: number): Promise<{ picked: number; stored: number }> {
  const db = env.DB;
  const { results: stories } = await db
    .prepare(
      `SELECT id, image_key, image_width, article_count FROM stories
       WHERE headline IS NOT NULL AND newsworthy = 1 AND hidden = 0 AND last_published_at > ?
         AND (image_key IS NULL OR image_width < ?) AND article_count > image_checked_articles
       ORDER BY pinned DESC, priority DESC, source_count DESC, last_published_at DESC
       LIMIT ${IMAGE_BATCH}`,
    )
    .bind(now - settings.windowHours * HOUR, MIN_WIDTH)
    .all<{ id: number; image_key: string | null; image_width: number | null; article_count: number }>();
  if (!stories.length) return { picked: 0, stored: 0 };

  const ids = stories.map((s) => s.id);
  const { results: articles } = await db
    .prepare(`SELECT story_id, url, image FROM articles WHERE story_id IN (${ids.map(() => "?").join(",")}) ORDER BY published_at ASC`)
    .bind(...ids)
    .all<{ story_id: number; url: string; image: string | null }>();

  let stored = 0;
  const stmts: D1PreparedStatement[] = [];
  await Promise.all(
    stories.map(async (s) => {
      const arts = articles.filter((a) => a.story_id === s.id);
      const img = await findStoryImage(
        [...new Set(arts.map((a) => a.image).filter((u): u is string => !!u))],
        arts.map((a) => a.url),
      );
      if (img && img.width > (s.image_key ? (s.image_width ?? 0) : -1)) {
        const key = await imageKey(s.id, img, now);
        await env.IMAGES.put(key, img.bytes, {
          httpMetadata: { contentType: img.type },
          customMetadata: { story: String(s.id), source: img.url },
        });
        if (s.image_key && s.image_key !== key) await env.IMAGES.delete(s.image_key);
        stmts.push(
          db
            .prepare("UPDATE stories SET image = ?, image_key = ?, image_width = ?, image_checked_articles = ? WHERE id = ?")
            .bind(img.url, key, img.width, s.article_count, s.id),
        );
        stored++;
      } else {
        stmts.push(db.prepare("UPDATE stories SET image_checked_articles = ? WHERE id = ?").bind(s.article_count, s.id));
      }
    }),
  );
  await db.batch(stmts);
  return { picked: stories.length, stored };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}


/**
 * The rolling window. Deletes stories whose newest article is more than RETENTION_DAYS old (with
 * their articles, rewrite and picture), stray articles and snapshots past it, and any R2 object
 * from before the window that no story uses. Pinned stories stay. Returns the stories deleted.
 */
export async function prune(env: Env, now: number): Promise<number> {
  const db = env.DB;
  const cutoff = now - RETENTION_DAYS * DAY;
  const { results: old } = await db
    .prepare("SELECT id, image_key FROM stories WHERE last_published_at < ? AND pinned = 0")
    .bind(cutoff)
    .all<{ id: number; image_key: string | null }>();
  const keys = old.map((s) => s.image_key).filter((k): k is string => !!k);
  for (let i = 0; i < keys.length; i += 1000) await env.IMAGES.delete(keys.slice(i, i + 1000));

  await db.batch([
    db.prepare("DELETE FROM articles WHERE story_id IN (SELECT id FROM stories WHERE last_published_at < ? AND pinned = 0)").bind(cutoff),
    db.prepare("DELETE FROM stories WHERE last_published_at < ? AND pinned = 0").bind(cutoff),
    db.prepare("DELETE FROM articles WHERE published_at < ? AND story_id IS NULL").bind(cutoff),
    db.prepare("DELETE FROM snapshots WHERE created_at < ? AND id <> (SELECT MAX(id) FROM snapshots)").bind(cutoff),
    db.prepare("DELETE FROM runs WHERE started_at < ?").bind(now - 30 * DAY),
  ]);

  // Safety net for objects a failed step left behind. Keys start with their day, so a listing
  // returns the oldest first; one page a run is plenty.
  const cutoffDay = new Date(cutoff).toISOString().slice(0, 10);
  const listing = await env.IMAGES.list({ limit: 500 });
  const stale = listing.objects.map((o) => o.key).filter((k) => (keyDay(k) ?? "") < cutoffDay);
  if (stale.length) {
    const { results: used } = await db
      .prepare(`SELECT image_key FROM stories WHERE image_key IN (${stale.slice(0, 90).map(() => "?").join(",")})`)
      .bind(...stale.slice(0, 90))
      .all<{ image_key: string }>();
    const keep = new Set(used.map((u) => u.image_key));
    const orphans = stale.slice(0, 90).filter((k) => !keep.has(k));
    if (orphans.length) await env.IMAGES.delete(orphans);
  }
  return old.length;
}
