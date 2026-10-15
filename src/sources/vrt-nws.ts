// VRT NWS, the Flemish public broadcaster. Its Atom feed tags every article with a section
// (`vrtns:nstag`: Binnenland, Europa, Justitie, Verenigde Staten, …), which this module can filter
// on and passes to the AI as a region/topic hint.

import { parseFeed } from "../feed.ts";
import { fetchFeedText, list, num, str, type SourceModule } from "./types.ts";

const FEEDS: Record<string, string> = {
  nl: "https://www.vrt.be/vrtnws/nl.rss.articles.xml",
  en: "https://www.vrt.be/vrtnws/en.rss.articles.xml",
};

export const vrtNws: SourceModule = {
  id: "vrt-nws",
  name: "VRT NWS",
  description: "All articles from VRT NWS, optionally limited to or excluding sections.",
  params: [
    { key: "language", label: "Edition", type: "select", options: ["nl", "en"], default: "nl" },
    {
      key: "includeTags",
      label: "Only sections",
      type: "list",
      help: "VRT section names, e.g. Binnenland, Europa, Politiek. Empty keeps all.",
    },
    { key: "excludeTags", label: "Skip sections", type: "list", help: "e.g. Podiumtip, Sport" },
  ],

  async fetch(config, ctx) {
    const url = FEEDS[str(config, "language", "nl")] ?? FEEDS.nl;
    const { body, etag, lastModified } = await fetchFeedText(url, ctx);
    if (body === null) return { items: [], notModified: true, etag, lastModified };

    const include = list(config, "includeTags").map((t) => t.toLowerCase());
    const exclude = list(config, "excludeTags").map((t) => t.toLowerCase());
    const items = parseFeed(body, 80, ["vrtns:nstag"])
      .filter((i) => {
        const tags = i.categories.map((c) => c.toLowerCase());
        if (include.length && !tags.some((t) => include.includes(t))) return false;
        return !tags.some((t) => exclude.includes(t));
      })
      .slice(0, num(config, "maxItems", 40))
      .map((i) => ({
        url: i.url,
        title: i.title,
        summary: i.summary,
        publishedAt: i.publishedAt,
        image: i.image,
        hint: i.categories.length ? `VRT section: ${i.categories.join(", ")}` : null,
      }));
    return { items, etag, lastModified };
  },
};
