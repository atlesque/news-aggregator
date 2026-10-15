// Bing News search as a feed. Reaches outlets without usable RSS of their own (Focus-WTV,
// The Brussels Times) and broad local searches. Unlike Google News, Bing answers requests
// from Cloudflare's network. Its exclusion operators (-word) are unreliable: use the
// `excludeKeywords` option instead.

import { parseFeed } from "../feed.ts";
import { fetchFeedText, num, str, type SourceModule } from "./types.ts";

/** Bing links go through a click-tracking redirect; the article URL is in its `url` parameter. */
export function unwrapBingLink(link: string): string {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith("bing.com") && u.searchParams.has("url")) return u.searchParams.get("url")!;
  } catch {
    // Not a URL; keep as is.
  }
  return link;
}

export const bingNews: SourceModule = {
  id: "bing-news",
  name: "Bing News search",
  description: "A Bing News search, newest first, e.g. `Brugge` or `site:focus-wtv.be`.",
  params: [
    { key: "query", label: "Search query", type: "string", required: true },
    { key: "market", label: "Market", type: "select", options: ["nl-BE", "fr-BE", "en-GB", "en-US", "de-DE"], default: "nl-BE" },
  ],

  async fetch(config, ctx) {
    const query = str(config, "query");
    if (!query) throw new Error("Search query is missing");
    const market = str(config, "market", "nl-BE");
    const params = new URLSearchParams({
      q: query,
      format: "rss",
      setlang: market,
      cc: market.split("-")[1] ?? "BE",
      qft: 'sortbydate="1"',
    });
    const { body, etag, lastModified } = await fetchFeedText(`https://www.bing.com/news/search?${params}`, ctx);
    if (body === null) return { items: [], notModified: true, etag, lastModified };

    const items = parseFeed(body, num(config, "maxItems", 40), ["News:Source"]).map((i) => ({
      url: unwrapBingLink(i.url),
      title: i.title,
      summary: i.summary.replace(/\s*\.\.\.$/, "…"),
      publishedAt: i.publishedAt,
      image: null,
      hint: i.categories[0] ? `Publisher: ${i.categories[0]}` : null,
    }));
    return { items, etag, lastModified };
  },
};
