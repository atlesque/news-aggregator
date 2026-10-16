// Read endpoints. Both serve the snapshot built by the last refresh and never touch the AI.
//
// Caching, cheapest first:
//   1. The browser / device keeps a response for 5 minutes (Cache-Control) and revalidates with an ETag.
//   2. The Cloudflare location's cache (Cache API) answers repeat requests without reading D1.
//   3. Each Worker isolate keeps the latest snapshot in memory for a minute.
//   4. Only then is D1 read: one small row.

import { HttpError, json } from "./http.ts";
import { parseQuery, queryKey, renderCompact, renderJson, renderRss, renderText, selectStories, type Format } from "./formats.ts";
import type { Snapshot } from "./rank.ts";
import { sha256Hex } from "./text.ts";

const EDGE_TTL = 300;
const BROWSER_TTL = 300;
const ISOLATE_TTL_MS = 60_000;

let memo: { id: number; snapshot: Snapshot; at: number } | null = null;

export async function latestSnapshot(db: D1Database): Promise<{ id: number; snapshot: Snapshot } | null> {
  if (memo && Date.now() - memo.at < ISOLATE_TTL_MS) return memo;
  const row = await db.prepare("SELECT id, json FROM snapshots ORDER BY id DESC LIMIT 1").first<{ id: number; json: string }>();
  if (!row) return null;
  memo = { id: row.id, snapshot: JSON.parse(row.json) as Snapshot, at: Date.now() };
  return memo;
}

export function forgetSnapshot() {
  memo = null;
}

function notModified(request: Request, etag: string, cacheControl: string): Response | null {
  const inm = request.headers.get("If-None-Match");
  if (inm && inm.split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
  }
  return null;
}

/** GET /api/public/news.json: what the public front page renders. */
export async function publicNews(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(new URL("/api/public/news.json", request.url).toString());
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const etag = cached.headers.get("ETag");
    return (etag && notModified(request, etag, cached.headers.get("Cache-Control") ?? "")) || cached;
  }

  const latest = await latestSnapshot(env.DB);
  if (!latest) {
    return json({ generatedAt: null, stories: [] }, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  const etag = `"s${latest.id}"`;
  const cacheControl = `public, max-age=${BROWSER_TTL}, s-maxage=${EDGE_TTL}, stale-while-revalidate=600`;
  const res = new Response(JSON.stringify(latest.snapshot), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl, ETag: etag },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return notModified(request, etag, cacheControl) ?? res;
}

// ---- API keys ----------------------------------------------------------------------------

const keyMemo = new Map<string, { id: number | null; at: number }>();

export function generateKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "nk_" + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function presentedKey(request: Request, url: URL): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return request.headers.get("X-API-Key") ?? url.searchParams.get("key");
}

async function authenticate(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<number> {
  const key = presentedKey(request, url);
  if (!key || !/^nk_[A-Za-z0-9]{20,64}$/.test(key)) throw new HttpError(401, "A valid API key is required");
  const hash = await sha256Hex(key);

  let hit = keyMemo.get(hash);
  if (!hit || Date.now() - hit.at > 60_000) {
    const row = await env.DB.prepare("SELECT id, last_used_at FROM api_keys WHERE hash = ? AND revoked_at IS NULL")
      .bind(hash)
      .first<{ id: number; last_used_at: number | null }>();
    hit = { id: row?.id ?? null, at: Date.now() };
    keyMemo.set(hash, hit);
    // Record use at most once per isolate-minute, so a busy device doesn't turn every read into a write.
    if (row) {
      ctx.waitUntil(env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), row.id).run());
    }
  }
  if (hit.id === null) throw new HttpError(401, "Unknown or revoked API key");

  const { success } = await env.API_LIMITER.limit({ key: `key:${hit.id}` });
  if (!success) throw new HttpError(429, "Too many requests. The news only changes four times a day.");
  return hit.id;
}

const CONTENT_TYPES: Record<Format, string> = {
  json: "application/json; charset=utf-8",
  compact: "application/json; charset=utf-8",
  rss: "application/rss+xml; charset=utf-8",
  text: "text/plain; charset=utf-8",
};

/** GET /api/v1/news[.json|.rss|.txt]: the keyed API for devices and feed readers. */
export async function keyedNews(request: Request, env: Env, ctx: ExecutionContext, format: Format | null): Promise<Response> {
  const url = new URL(request.url);
  await authenticate(request, env, ctx, url);

  const q = parseQuery(url.searchParams, format ?? "json");
  if (format) q.format = format;

  // Responses don't depend on which key asked, so they are cached per query, not per key.
  const cacheKey = new Request(`${url.origin}/__cache/v1/${queryKey(q)}`);
  const cacheControl = `private, max-age=${BROWSER_TTL}`;
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const etag = cached.headers.get("ETag");
    const res = (etag && notModified(request, etag, cacheControl)) || new Response(cached.body, cached);
    res.headers.set("Cache-Control", cacheControl);
    return res;
  }

  const latest = await latestSnapshot(env.DB);
  if (!latest) throw new HttpError(503, "No news yet. The first refresh hasn't finished.");
  const stories = selectStories(latest.snapshot, q);
  const selfUrl = new URL(url);
  selfUrl.searchParams.delete("key");
  const body =
    q.format === "rss"
      ? renderRss(latest.snapshot, stories, env.SITE_URL, selfUrl.toString())
      : q.format === "compact"
        ? renderCompact(latest.snapshot, stories)
        : q.format === "text"
          ? renderText(latest.snapshot, stories)
          : renderJson(latest.snapshot, stories);

  const etag = `"s${latest.id}-${(await sha256Hex(queryKey(q))).slice(0, 8)}"`;
  const res = new Response(body, {
    headers: {
      "Content-Type": CONTENT_TYPES[q.format],
      "Cache-Control": `public, s-maxage=${EDGE_TTL}`,
      ETag: etag,
      "Content-Length": String(new TextEncoder().encode(body).byteLength),
    },
  });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  const out = notModified(request, etag, cacheControl) ?? new Response(res.body, res);
  out.headers.set("Cache-Control", cacheControl);
  return out;
}
