import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { imageSize, pageImage } from "../src/images.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { backfillDedupKeys, dropIngested, imageBatch, prune } from "../src/store.ts";
import { canonicalUrl, dedupKey } from "../src/text.ts";
import { fakeD1, fakeR2, png } from "./helpers/d1.ts";

const HOUR = 3_600_000;
const now = Date.parse("2026-10-16T12:00:00Z");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers fetches from a URL → response map; anything else is a 404. */
function serve(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    return routes[url]?.() ?? new Response("no", { status: 404 });
  }) as typeof fetch;
  return calls;
}
const image = (bytes: Uint8Array, type = "image/png") => () => new Response(bytes, { headers: { "content-type": type } });
const html = (body: string) => () => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

function addStory(db: ReturnType<typeof fakeD1>, id: number, o: { last?: number; pinned?: number; imageKey?: string; width?: number } = {}) {
  const last = o.last ?? now - HOUR;
  db.raw
    .prepare(
      `INSERT INTO stories (id, created_at, updated_at, first_published_at, last_published_at, article_count, source_count, headline, summary,
         region, topic, priority, pinned, image_key, image_width) VALUES (?, ?, ?, ?, ?, 0, 1, ?, 'S', 'local', 'society', 2, ?, ?, ?)`,
    )
    .run(id, last, last, last, last, `Story ${id}`, o.pinned ?? 0, o.imageKey ?? null, o.width ?? null);
}
function addArticle(db: ReturnType<typeof fakeD1>, id: string, storyId: number | null, url: string, o: { image?: string; published?: number; title?: string } = {}) {
  db.raw
    .prepare("INSERT INTO articles (id, source_id, url, title, image, published_at, fetched_at, story_id) VALUES (?, 1, ?, ?, ?, ?, ?, ?)")
    .run(id, url, o.title ?? `Title ${id}`, o.image ?? null, o.published ?? now - HOUR, now, storyId);
  if (storyId !== null) db.raw.prepare("UPDATE stories SET article_count = article_count + 1 WHERE id = ?").run(storyId);
}

test("canonicalUrl undoes double-escaped tracking links", () => {
  assert.equal(
    canonicalUrl("https://www.brusselstimes.com/belgium/2362461/x?amp;utm_medium=Social&amp;utm_source=Twitter"),
    "https://www.brusselstimes.com/belgium/2362461/x",
  );
  assert.equal(canonicalUrl("https://www.hln.be/brugge/x~ac18b01f/?slug_rd=1"), "https://www.hln.be/brugge/x~ac18b01f/");
});

test("dedupKey matches one outlet's article under different URLs, not other outlets", () => {
  const t = "'Blatant failure': Brussels residents launch petition to change Schuman roundabout";
  const a = dedupKey("https://www.brusselstimes.com/belgium/2362461/blatant-failure", t);
  assert.equal(a, dedupKey("https://brusselstimes.com/eu-affairs/2362461/blatant-failure-brussels-res", t));
  assert.notEqual(a, dedupKey("https://kw.be/nieuws/blatant-failure", t));
  assert.equal(dedupKey("https://a.be/x", "Kort"), null);
});

test("already-ingested items are dropped by URL or by outlet and headline, also within a batch", async () => {
  const db = fakeD1();
  const title = "Why Europe should open the door to Australia and New Zealand";
  db.raw
    .prepare("INSERT INTO articles (id, source_id, url, title, published_at, fetched_at, dedup_key) VALUES ('a1', 6, 'u', ?, 0, 0, ?)")
    .run(title, dedupKey("https://www.brusselstimes.com/opinion/2362263/why-europe", title));
  const rows = [
    { id: "a1", key: null },
    { id: "a2", key: dedupKey("https://www.brusselstimes.com/opinion/2362263/why-europe-should-open-the-door-to-australia-and-new-zeal", title) },
    { id: "a3", key: "x.be|something new happened today" },
    { id: "a4", key: "x.be|something new happened today" },
    { id: "a3", key: null },
  ];
  assert.deepEqual((await dropIngested(db, rows)).map((r) => r.id), ["a3"]);
});

test("backfill gives old rows a dedup key once", async () => {
  const db = fakeD1();
  addArticle(db, "old", null, "https://www.brusselstimes.com/x", { title: "Belgian police raid houses of family members" });
  addArticle(db, "short", null, "https://a.be/y", { title: "Kort" });
  assert.equal(await backfillDedupKeys(db), 2);
  assert.equal(await backfillDedupKeys(db), 0);
  assert.equal(db.raw.prepare("SELECT dedup_key FROM articles WHERE id = 'old'").get()!.dedup_key, "brusselstimes.com|belgian police raid houses family members");
});

test("pageImage reads og:image, resolves relative URLs and prefers secure_url", () => {
  assert.equal(pageImage(`<head><meta property="og:image" content="/img/a.jpg?w=1200&amp;h=630"></head>`, "https://kw.be/nieuws/x"), "https://kw.be/img/a.jpg?w=1200&h=630");
  assert.equal(
    pageImage(`<meta content='http://e.x/a.jpg' property='og:image'><meta property="og:image:secure_url" content="https://e.x/b.jpg">`, "https://e.x/"),
    "https://e.x/b.jpg",
  );
  assert.equal(pageImage(`<meta name="twitter:image" content="https://e.x/t.jpg">`, "https://e.x/"), "https://e.x/t.jpg");
  assert.equal(pageImage(`<title>none</title>`, "https://e.x/"), null);
});

test("imageSize reads PNG, GIF, JPEG and WebP headers", () => {
  assert.deepEqual(imageSize(png(1200, 630)), { width: 1200, height: 630 });
  assert.deepEqual(imageSize(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02])), { width: 800, height: 600 });
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x02, 0x76, 0x04, 0xb0, 3, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg), { width: 1200, height: 630 });
  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  webp.set([0xaf, 0x04, 0x00, 0x75, 0x02, 0x00], 24);
  assert.deepEqual(imageSize(webp), { width: 1200, height: 630 });
});

test("a story without feed images gets the og:image of its article, stored in R2", async () => {
  const db = fakeD1();
  const IMAGES = fakeR2();
  addStory(db, 1);
  addArticle(db, "e1", 1, "https://www.euronews.com/2026/10/16/a");
  serve({
    "https://www.euronews.com/2026/10/16/a": html(`<html><head><meta property="og:image" content="https://static.euronews.com/a.png"></head><body>…`),
    "https://static.euronews.com/a.png": image(png(1200, 675)),
  });
  const r = await imageBatch({ DB: db, IMAGES } as unknown as Env, DEFAULT_SETTINGS, now);
  assert.deepEqual(r, { picked: 1, stored: 1 });
  const row = db.raw.prepare("SELECT image, image_key, image_width FROM stories WHERE id = 1").get()!;
  assert.equal(row.image, "https://static.euronews.com/a.png");
  assert.equal(row.image_width, 1200);
  assert.match(String(row.image_key), /^2026-10-16\/1-[0-9a-f]{12}\.png$/);
  assert.equal(IMAGES.objects.get(String(row.image_key))?.type, "image/png");
  // Nothing new joined the story: it isn't looked at again.
  assert.deepEqual(await imageBatch({ DB: db, IMAGES } as unknown as Env, DEFAULT_SETTINGS, now), { picked: 0, stored: 0 });
});

test("a small feed thumbnail is replaced by a larger page image, and SVG or tiny images are refused", async () => {
  const db = fakeD1();
  const IMAGES = fakeR2();
  addStory(db, 1);
  addArticle(db, "b1", 1, "https://www.bbc.co.uk/news/articles/x", { image: "https://ichef.bbci.co.uk/ace/standard/240/x.jpg" });
  addArticle(db, "v1", 1, "https://vrtnws.be/p.1", { image: "https://images.vrt.be/logo.svg" });
  serve({
    "https://ichef.bbci.co.uk/ace/standard/240/x.jpg": image(png(240, 135)),
    "https://images.vrt.be/logo.svg": image(new TextEncoder().encode("<svg onload=alert(1)>".padEnd(2000)), "image/svg+xml"),
    "https://www.bbc.co.uk/news/articles/x": html(`<meta property="og:image" content="https://ichef.bbci.co.uk/news/1024/x.jpg">`),
    "https://ichef.bbci.co.uk/news/1024/x.jpg": image(png(1024, 576)),
  });
  await imageBatch({ DB: db, IMAGES } as unknown as Env, DEFAULT_SETTINGS, now);
  const row = db.raw.prepare("SELECT image, image_width FROM stories WHERE id = 1").get()!;
  assert.equal(row.image, "https://ichef.bbci.co.uk/news/1024/x.jpg");
  assert.equal(row.image_width, 1024);
  assert.equal(IMAGES.objects.size, 1);
});

test("a story with no picture anywhere stays without one until a new article joins", async () => {
  const db = fakeD1();
  const IMAGES = fakeR2();
  addStory(db, 1);
  addArticle(db, "k1", 1, "https://kw.be/a");
  const calls = serve({ "https://kw.be/a": html("<head><title>No picture</title></head>") });
  assert.deepEqual(await imageBatch({ DB: db, IMAGES } as unknown as Env, DEFAULT_SETTINGS, now), { picked: 1, stored: 0 });
  assert.deepEqual(await imageBatch({ DB: db, IMAGES } as unknown as Env, DEFAULT_SETTINGS, now), { picked: 0, stored: 0 });
  addArticle(db, "k2", 1, "https://hln.be/b", { image: "https://hln.be/b.png" });
  serve({ "https://hln.be/b.png": image(png(800, 450)) });
  assert.deepEqual(await imageBatch({ DB: db, IMAGES } as unknown as Env, DEFAULT_SETTINGS, now), { picked: 1, stored: 1 });
  assert.equal(calls.length, 1);
});

test("prune deletes stories, articles and pictures older than three days, but keeps pinned ones", async () => {
  const db = fakeD1();
  const IMAGES = fakeR2();
  const old = now - 73 * HOUR;
  addStory(db, 1, { last: old, imageKey: "2026-10-13/1-aaaaaaaaaaaa.jpg" });
  addArticle(db, "o1", 1, "https://e.x/o1", { published: old });
  addStory(db, 2, { last: now - 71 * HOUR, imageKey: "2026-10-13/2-bbbbbbbbbbbb.jpg" });
  addArticle(db, "r1", 2, "https://e.x/r1", { published: now - 71 * HOUR });
  addStory(db, 3, { last: old, pinned: 1, imageKey: "2026-10-12/3-cccccccccccc.jpg" });
  addArticle(db, "stray", null, "https://e.x/s", { published: old });
  for (const k of ["2026-10-13/1-aaaaaaaaaaaa.jpg", "2026-10-13/2-bbbbbbbbbbbb.jpg", "2026-10-12/3-cccccccccccc.jpg", "2026-10-01/9-orphan.jpg", "2026-10-16/9-new.jpg"]) {
    await IMAGES.put(k, png(10, 10));
  }
  db.raw.prepare("INSERT INTO snapshots (created_at, json) VALUES (?, '{}'), (?, '{}')").run(old, now);

  assert.equal(await prune({ DB: db, IMAGES } as unknown as Env, now), 1);
  assert.deepEqual(db.raw.prepare("SELECT id FROM stories ORDER BY id").all().map((r) => r.id), [2, 3]);
  assert.deepEqual(db.raw.prepare("SELECT id FROM articles ORDER BY id").all().map((r) => r.id), ["r1"]);
  assert.deepEqual([...IMAGES.objects.keys()].sort(), ["2026-10-12/3-cccccccccccc.jpg", "2026-10-13/2-bbbbbbbbbbbb.jpg", "2026-10-16/9-new.jpg"]);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM snapshots").get()!.n, 1);
});
