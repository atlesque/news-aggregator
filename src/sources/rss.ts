import { parseFeed } from "../feed.ts";
import { fetchFeedText, num, str, type SourceModule } from "./types.ts";

export const rss: SourceModule = {
  id: "rss",
  name: "RSS / Atom feed",
  description: "Any RSS 2.0 or Atom feed.",
  params: [{ key: "url", label: "Feed URL", type: "url", required: true }],

  async fetch(config, ctx) {
    const url = str(config, "url");
    if (!/^https?:\/\//.test(url)) throw new Error("Feed URL is missing");
    const { body, etag, lastModified } = await fetchFeedText(url, ctx);
    if (body === null) return { items: [], notModified: true, etag, lastModified };
    const items = parseFeed(body, num(config, "maxItems", 40)).map((i) => ({
      url: i.url,
      title: i.title,
      summary: i.summary,
      publishedAt: i.publishedAt,
      image: i.image,
      hint: i.categories.slice(0, 4).join(", ") || null,
    }));
    return { items, etag, lastModified };
  },
};
