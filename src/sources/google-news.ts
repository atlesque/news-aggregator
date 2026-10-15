// Google News search as a feed. Covers publishers without RSS of their own (Belga, Focus-WTV,
// The Brussels Times) through `site:` queries, and local news through keyword searches.

import { parseFeed } from "../feed.ts";
import { fetchFeedText, num, str, type SourceModule } from "./types.ts";

export const googleNews: SourceModule = {
  id: "google-news",
  name: "Google News search",
  description: "A Google News search, e.g. `Brugge -voetbal` or `site:belganewsagency.eu`.",
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
