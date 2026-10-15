// Google News search as a feed. Note: Google answers requests from Cloudflare's network with
// HTTP 503, so this only works where the Worker's egress isn't blocked (e.g. local dev).
// Prefer bing-news on Cloudflare.

import { parseFeed } from "../feed.ts";
import { fetchFeedText, num, str, type SourceModule } from "./types.ts";

export const googleNews: SourceModule = {
  id: "google-news",
  name: "Google News search",
  description: "A Google News search. Google blocks requests from Cloudflare (HTTP 503): prefer Bing News search.",
  params: [
    { key: "query", label: "Search query", type: "string", required: true, help: "Google News search syntax." },
    { key: "language", label: "Language", type: "select", options: ["nl", "fr", "en", "de"], default: "nl" },
    { key: "country", label: "Country", type: "string", default: "BE" },
    { key: "window", label: "Time window", type: "select", options: ["1h", "12h", "1d", "2d", "7d"], default: "2d" },
  ],

  async fetch(config, ctx) {
    const query = str(config, "query");
    if (!query) throw new Error("Search query is missing");
    const lang = str(config, "language", "nl");
    const country = str(config, "country", "BE").toUpperCase();
    const window = str(config, "window", "2d");
    const params = new URLSearchParams({
      q: `${query} when:${window}`,
      hl: lang === "en" ? `en-${country}` : lang,
      gl: country,
      ceid: `${country}:${lang}`,
    });
    const { body, etag, lastModified } = await fetchFeedText(`https://news.google.com/rss/search?${params}`, ctx);
    if (body === null) return { items: [], notModified: true, etag, lastModified };

    const items = parseFeed(body, num(config, "maxItems", 40)).map((i) => {
      // Titles come as "Headline - Publisher"; the description only repeats the title.
      const publisher = i.publisher;
      const title = publisher && i.title.endsWith(` - ${publisher}`) ? i.title.slice(0, -publisher.length - 3) : i.title;
      return {
        url: i.url,
        title,
        summary: "",
        publishedAt: i.publishedAt,
        image: null,
        hint: publisher ? `Publisher: ${publisher}` : null,
      };
    });
    return { items, etag, lastModified };
  },
};
