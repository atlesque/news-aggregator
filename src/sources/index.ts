// Registry of source modules. To add a new kind of source, write a module implementing
// `SourceModule` (see rss.ts for the smallest example) and list it here; it then shows up in
// the admin's "Add source" form with a field for each of its params.

import { bingNews } from "./bing-news.ts";
import { googleNews } from "./google-news.ts";
import { rss } from "./rss.ts";
import { COMMON_PARAMS, type SourceModule } from "./types.ts";
import { vrtNws } from "./vrt-nws.ts";

export const MODULES: SourceModule[] = [rss, vrtNws, bingNews, googleNews];

export function getModule(id: string): SourceModule | undefined {
  return MODULES.find((m) => m.id === id);
}

export function describeModules() {
  return MODULES.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    params: [...m.params, ...COMMON_PARAMS],
  }));
}
