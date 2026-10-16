// A small, allocation-light RSS 2.0 / Atom parser. Workers have no DOMParser, and a full XML
// library would cost more CPU than the free plan's 10 ms per step allows.

import { decodeEntities, plainText } from "./text.ts";

export interface FeedItem {
  title: string;
  url: string;
  summary: string;
  publishedAt: number | null;
  image: string | null;
  categories: string[];
  /** Publisher named inside the item (Google News `<source>`). */
  publisher: string | null;
}

/** Inner text of the first `<tag>` in `xml`, CDATA unwrapped, entities decoded. */
function tagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(xml);
  if (!m) return null;
  const inner = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(inner).trim();
}

function allTagText(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) {
    const v = plainText(m[1]);
    if (v) out.push(v);
  }
  return out;
}

function attr(tagSource: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tagSource);
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : null;
}

function parseDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : null;
}

/** The widest image the item offers (feeds often list a thumbnail first). */
function findImage(xml: string): string | null {
  let best: string | null = null;
  let bestWidth = -1;
  for (const m of xml.matchAll(/<(media:content|media:thumbnail|enclosure|link)\b[^>]*>/gi)) {
    const tag = m[0];
    const kind = m[1].toLowerCase();
    if (kind === "link" && attr(tag, "rel") !== "enclosure") continue;
    const type = attr(tag, "type");
    const medium = attr(tag, "medium");
    if (type && !type.startsWith("image/") && medium !== "image") continue;
    const url = attr(tag, "url") ?? attr(tag, "href");
    if (!url || !/^https:\/\//.test(url)) continue;
    const width = Number(attr(tag, "width") ?? 0) || 0;
    if (width > bestWidth) {
      best = url;
      bestWidth = width;
    }
  }
  // Bing News puts its thumbnail in a tag of its own.
  if (!best) {
    const bing = tagText(xml, "News:Image");
    if (bing && /^https:\/\//.test(bing)) best = bing;
  }
  return best;
}

/** `extraCategoryTags` names publisher-specific tags to read as categories, e.g. VRT's `vrtns:nstag`. */
export function parseFeed(xml: string, maxItems = 50, extraCategoryTags: string[] = []): FeedItem[] {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 2000)) && !/<rss[\s>]/i.test(xml.slice(0, 2000));
  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const items: FeedItem[] = [];

  for (const m of xml.matchAll(blockRe)) {
    if (items.length >= maxItems) break;
    const block = m[0];
    const title = plainText(tagText(block, "title") ?? "");
    let url: string | null = null;
    if (isAtom) {
      for (const l of block.matchAll(/<link\b[^>]*>/gi)) {
        const rel = attr(l[0], "rel") ?? "alternate";
        if (rel === "alternate") {
          url = attr(l[0], "href");
          break;
        }
      }
    } else {
      url = tagText(block, "link") || null;
      if (!url) {
        const guid = /<guid\b[^>]*>([\s\S]*?)<\/guid>/i.exec(block);
        if (guid && !/isPermaLink\s*=\s*["']false/i.test(guid[0])) url = plainText(guid[1]);
      }
    }
    if (!title || !url || !/^https?:\/\//.test(url)) continue;

    const rawSummary =
      tagText(block, isAtom ? "summary" : "description") ?? tagText(block, "content") ?? tagText(block, "content:encoded") ?? "";
    const published = parseDate(
      tagText(block, isAtom ? "published" : "pubDate") ?? tagText(block, "updated") ?? tagText(block, "dc:date"),
    );
    const categories = isAtom
      ? [...block.matchAll(/<category\b[^>]*>/gi)].map((c) => attr(c[0], "term") ?? "").filter(Boolean)
      : allTagText(block, "category");
    for (const tag of extraCategoryTags) categories.push(...allTagText(block, tag));

    items.push({
      title,
      url: url.trim(),
      summary: plainText(rawSummary),
      publishedAt: published,
      image: findImage(block),
      categories,
      publisher: tagText(block, "source") ? plainText(tagText(block, "source")!) : null,
    });
  }
  return items;
}
