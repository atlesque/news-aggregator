// One picture per story, copied into R2 so the page never depends on hotlinking. Candidates are
// the images the feeds carried, then the og:image of the articles' own pages (many feeds, such
// as Euronews, Politico and every Bing search, carry none, and BBC's are 240 px thumbnails).
// The first one at least MIN_WIDTH wide wins; otherwise the widest one found.

import { USER_AGENT } from "./sources/types.ts";
import { decodeEntities, sha256Hex } from "./text.ts";

/** Pictures narrower than this are kept only until a better one turns up. */
export const MIN_WIDTH = 600;
const MAX_IMAGE_BYTES = 5_000_000;
const MAX_HEAD_BYTES = 250_000;
/** Bounds the subrequests one story can use (the free plan allows 50 per step). */
const MAX_PAGES = 3;
const MAX_DOWNLOADS = 5;

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

/** The og:image (or twitter:image) a page declares in its head, as an absolute https URL. */
export function pageImage(html: string, pageUrl: string): string | null {
  const found: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /\s(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\scontent\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!key || !content) continue;
    const value = decodeEntities((content[2] ?? content[3] ?? content[4] ?? "").trim());
    if (value && !(key in found)) found[key] = value;
  }
  const raw = found["og:image:secure_url"] ?? found["og:image"] ?? found["og:image:url"] ?? found["twitter:image"] ?? found["twitter:image:src"];
  if (!raw) return null;
  try {
    const u = new URL(raw, pageUrl);
    if (u.protocol === "http:") u.protocol = "https:";
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Width and height read from the file header of a JPEG, PNG, GIF or WebP. Null when unknown. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32be(16), height: u32be(20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(6), height: u16le(8) };
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      // Start-of-frame markers carry the dimensions (C4, C8 and CC are not frames).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(i + 7), height: u16be(i + 5) };
      }
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

/** Reads a page until its </head> (or a size cap) and returns the picture it declares. */
export async function fetchPageImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok || !res.body || !/html/i.test(res.headers.get("content-type") ?? "")) {
      await res.body?.cancel();
      return null;
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let html = "";
    while (html.length < MAX_HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += value;
      if (/<\/head>/i.test(html.slice(-value.length - 7))) break;
    }
    await reader.cancel().catch(() => {});
    return pageImage(html, res.url || url);
  } catch {
    return null;
  }
}

export interface Downloaded {
  url: string;
  bytes: Uint8Array;
  type: string;
  width: number;
}

/** Downloads an image. Null for anything that isn't a raster image of a sane size (SVG is refused: it can carry script). */
export async function downloadImage(url: string): Promise<Downloaded | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !(type in TYPES) || Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) {
      await res.body?.cancel();
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 1000 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    const size = imageSize(bytes);
    // Tracking pixels and icons are not pictures.
    if (size && (size.width < 200 || size.height < 100)) return null;
    // AVIF and odd JPEGs have no size we can read: accept them as good enough.
    return { url, bytes, type, width: size?.width ?? MIN_WIDTH };
  } catch {
    return null;
  }
}

/**
 * Finds the best picture for one story. `feedImages` are tried first (cheapest), then the
 * pages of `articleUrls`. Stops at the first picture at least MIN_WIDTH wide.
 */
export async function findStoryImage(feedImages: string[], articleUrls: string[], minWidth = MIN_WIDTH): Promise<Downloaded | null> {
  let best: Downloaded | null = null;
  let downloads = 0;
  const tried = new Set<string>();
  const consider = async (url: string | null) => {
    if (!url || tried.has(url) || downloads >= MAX_DOWNLOADS) return false;
    tried.add(url);
    downloads++;
    const img = await downloadImage(url);
    if (img && (!best || img.width > best.width)) best = img;
    return !!img && img.width >= minWidth;
  };
  for (const url of feedImages) if (await consider(url)) return best;
  for (const url of articleUrls.slice(0, MAX_PAGES)) {
    if (downloads >= MAX_DOWNLOADS) break;
    if (await consider(await fetchPageImage(url))) return best;
  }
  return best;
}

/** R2 key for a story's picture. The day prefix lets the cleanup find old objects by listing. */
export async function imageKey(storyId: number, img: Pick<Downloaded, "url" | "type">, now: number): Promise<string> {
  const day = new Date(now).toISOString().slice(0, 10);
  return `${day}/${storyId}-${(await sha256Hex(img.url)).slice(0, 12)}.${TYPES[img.type] ?? "img"}`;
}

/** The day an R2 key was written, from its prefix. */
export function keyDay(key: string): string | null {
  return /^(\d{4}-\d{2}-\d{2})\//.exec(key)?.[1] ?? null;
}

/** Serves /img/<key> from R2. Keys never change content, so browsers may keep them forever. */
export async function serveImage(request: Request, bucket: R2Bucket, key: string): Promise<Response> {
  // Keys are plain ASCII (day/story-hash.ext), so anything else is not one of ours.
  if (!/^\d{4}-\d{2}-\d{2}\/[\w-]+\.\w+$/.test(key)) return new Response("Not found", { status: 404 });
  const obj = await bucket.get(key, { onlyIf: request.headers });
  if (!obj) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}
