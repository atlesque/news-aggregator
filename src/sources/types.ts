// The contract every source module implements. A module is a kind of source (an RSS feed, the
// VRT NWS feed, a Google News search); the admin creates any number of configured instances.

export interface ParamSpec {
  key: string;
  label: string;
  type: "string" | "url" | "number" | "list" | "select";
  required?: boolean;
  options?: string[];
  default?: string | number | string[];
  help?: string;
}

export interface SourceItem {
  url: string;
  title: string;
  summary: string;
  publishedAt: number | null;
  image: string | null;
  /** Section labels or tags from the publisher, passed to the AI as a hint for region and topic. */
  hint: string | null;
}

export interface FetchContext {
  etag: string | null;
  lastModified: string | null;
}

export interface FetchResult {
  items: SourceItem[];
  /** True when the server answered 304: nothing changed since the last fetch. */
  notModified?: boolean;
  etag?: string | null;
  lastModified?: string | null;
}

export type SourceConfig = Record<string, unknown>;

export interface SourceModule {
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  fetch(config: SourceConfig, ctx: FetchContext): Promise<FetchResult>;
}

/** Parameters every module accepts; the pipeline applies them after the module returns. */
export const COMMON_PARAMS: ParamSpec[] = [
  { key: "maxItems", label: "Max items per fetch", type: "number", default: 40 },
  { key: "maxAgeHours", label: "Ignore items older than (hours)", type: "number", default: 36 },
  { key: "includeKeywords", label: "Only keep items mentioning", type: "list", help: "Comma-separated. Empty keeps everything." },
  { key: "excludeKeywords", label: "Drop items mentioning", type: "list", help: "Comma-separated." },
];

export const USER_AGENT = "AtlesqueNews/1.0 (+https://news.atlesque.dev; hourly news aggregator)";
const MAX_FEED_BYTES = 2_000_000;

/** Conditional GET of a feed. Returns null body on 304. */
export async function fetchFeedText(
  url: string,
  ctx: FetchContext,
): Promise<{ body: string | null; etag: string | null; lastModified: string | null }> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  };
  if (ctx.etag) headers["If-None-Match"] = ctx.etag;
  if (ctx.lastModified) headers["If-Modified-Since"] = ctx.lastModified;

  let res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  // Some publishers' bot protection turns a request away now and then; one retry usually passes.
  if (res.status === 403 || res.status === 429 || res.status >= 500) {
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  }
  if (res.status === 304) {
    await res.body?.cancel();
    return { body: null, etag: ctx.etag, lastModified: ctx.lastModified };
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  }
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FEED_BYTES) {
    await res.body?.cancel();
    throw new Error(`Feed too large (${length} bytes)`);
  }
  const body = await res.text();
  return {
    body: body.length > MAX_FEED_BYTES ? body.slice(0, MAX_FEED_BYTES) : body,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

export function str(config: SourceConfig, key: string, fallback = ""): string {
  const v = config[key];
  return typeof v === "string" ? v.trim() : fallback;
}

export function num(config: SourceConfig, key: string, fallback: number): number {
  const v = Number(config[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function list(config: SourceConfig, key: string): string[] {
  const v = config[key];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}
