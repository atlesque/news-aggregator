# News Aggregator

A calm, hourly news front page for Bruges, Belgium, Europe and the world, with a keyed JSON/RSS API for small devices like an ESP32 e-ink display. It runs entirely on Cloudflare's free tier.

**Live:** https://news.atlesque.dev

## How it works

Every hour at minute 7, a cron trigger starts a [Workflow](https://developers.cloudflare.com/workflows/) that runs these steps:

1. **Fetch** each enabled source (one step per source, using conditional GETs). New articles are stored in D1, keyed by a hash of their canonical URL, so refetches are free.
2. **Cluster** new articles into stories. Each article is embedded with the multilingual `@cf/baai/bge-m3` model. It joins the most similar recent story or starts a new one, so a Dutch HLN report and an English Brussels Times report of the same event become one story.
3. **Enrich** new and updated stories in batches of 8 with one Workers AI call per batch (default `@cf/google/gemma-4-26b-a4b-it`). Each story gets:
   - a neutral headline with no clickbait and a 1–2 sentence summary, in a language you choose;
   - a region, limited to the regions its sources are allowed to cover;
   - a topic, a priority (high/medium/low) and a breaking flag;
   - a "newsworthy" flag, so ads, quizzes and listings are dropped.
4. **Publish** a snapshot. Stories are scored by priority, breaking, number of reporting sources and age. A second duplicate check compares the rewritten headlines, which are now all in one language. Each region is then filled up to its quota (default: Bruges 8, Belgium 10, Europe 6, World 8). The snapshot is stored as a single D1 row.

Each step runs in its own invocation with its own CPU budget and retries independently. A failing feed is recorded on the source and skipped. This keeps every step inside the free plan's 10 ms CPU limit.

## Serving and caching

| Request | Served by | Cost |
| --- | --- | --- |
| `/`, `/app.js`, `/app.css` | Workers Static Assets | Free and unlimited; the Worker doesn't run |
| `/api/public/news.json` (front page data) | Worker → edge cache → isolate memory → one D1 row | One cheap Worker request |
| `/api/v1/news*` (keyed API) | Worker → per-query edge cache | One cheap Worker request |

JSON responses carry `Cache-Control: max-age=300` and an `ETag`, so browsers and devices revalidate with a 304 instead of downloading again. The edge cache serves repeat requests from each Cloudflare location without touching D1. The AI only runs in the hourly Workflow, never on a request. Traffic doesn't change AI usage.

## Sources

Sources are instances of **source modules** (`src/sources/`):

| Module | What it reads |
| --- | --- |
| `rss` | Any RSS 2.0 or Atom feed |
| `vrt-nws` | VRT NWS, with optional section filters (Binnenland, Europa, …) |
| `bing-news` | A Bing News search, newest first. Covers outlets without RSS, such as Focus-WTV (`site:focus-wtv.be`) and The Brussels Times |
| `google-news` | A Google News search. Google blocks requests from Cloudflare's network (HTTP 503), so this only works in local dev |

Every source also takes `maxItems`, `maxAgeHours`, `includeKeywords` and `excludeKeywords`. Each source has a list of **regions** its stories may be filed under. HLN Brugge only feeds "Bruges"; BBC World only "World" and "Europe".

The starter set (`migrations/0001_init.sql`):

- **Bruges:** HLN Brugge, Bing News "Brugge", Focus-WTV
- **Belgium:** VRT NWS, The Brussels Times
- **Europe:** Euronews, Politico Europe
- **World:** BBC World, The Guardian

You can add, edit, test and disable sources in `/admin`. Test a new feed from the deployed admin, not only locally. Some publishers block Cloudflare's IP ranges: Google News does, and Mediahuis titles (Nieuwsblad, De Standaard) redirect to a login.

**Adding a new kind of source:** write a module that implements `SourceModule` in `src/sources/types.ts`; `rss.ts` is the smallest example. Then add it to `MODULES` in `src/sources/index.ts`. The admin's "Add source" form builds its fields from the module's `params`.

## API

Create a key in `/admin` → API keys. The key is shown once; only its SHA-256 hash is stored.

```
GET /api/v1/news                JSON
GET /api/v1/news.compact.json   short keys, no URLs: for microcontrollers
GET /api/v1/news.rss            RSS 2.0
GET /api/v1/news.txt            plain text
```

**Auth:** send the key in one of three ways:

- `Authorization: Bearer nk_…`
- `X-API-Key: nk_…`
- `?key=nk_…` (for feed readers that can't set headers)

**Query parameters:**

| Parameter | Values | Default |
| --- | --- | --- |
| `region` | `local`, `national`, `europe`, `world` (comma-separated) | all |
| `topic` | `politics`, `economy`, `society`, `crime`, `health`, `science`, `technology`, `environment`, `culture`, `sports`, `mobility`, `weather`, `other` | all |
| `minPriority` | `low`, `medium`, `high` | `low` |
| `breaking` | `1` = only breaking stories | off |
| `limit` | 1–100 | 20 |
| `summary` | `0` = headlines only | `1` |
| `maxSummary` | 40–2000 characters | 400 |
| `ascii` | `1` = fold accents and typographic quotes to plain ASCII, for display fonts without them | off |
| `format` | `json`, `compact`, `rss`, `text` | `json` |

Each key is limited to 30 requests per minute. The data changes once an hour.

**Compact format:** about 300 bytes per story, so 8 stories fit easily in a 16 KB buffer.

```json
{"t":1792061024,"n":1792062600,"i":[{"h":"Prison guard attacked in Bruges prison","s":"A prison guard was attacked…","r":"local","c":"crime","p":3,"b":0,"a":1792049168,"o":"HLN"}]}
```

The keys are:

- `t`: generated (Unix seconds)
- `n`: next update (Unix seconds); a device can sleep until then
- `h`: headline
- `s`: summary
- `r`: region
- `c`: topic
- `p`: priority, 3 = high, 1 = low
- `b`: breaking (0/1)
- `a`: last update (Unix seconds)
- `o`: outlet (first source)

ESP32 sketch:

```cpp
HTTPClient http;
http.begin("https://news.atlesque.dev/api/v1/news.compact.json?limit=8&ascii=1&maxSummary=160");
http.addHeader("Authorization", "Bearer " NEWS_API_KEY);
int code = http.GET();  // 200, or 304 if you send If-None-Match with the last ETag
```

## Admin

`/admin` lets you:

- see run history;
- refresh now;
- manage sources (with a test fetch);
- create and revoke API keys;
- hide, pin or re-prioritise stories;
- edit settings: site title, region labels and quotas, summary language, AI model, duplicate thresholds, the cap on AI rewrites per run, and topics to leave out.

A Cloudflare Access application protects `/admin` and `/api/admin/*`. The Worker also verifies the Access JWT itself (`Cf-Access-Jwt-Assertion`, checked against `ACCESS_AUD`), so admin stays closed even if a request bypasses Access. It fails closed while `ACCESS_AUD` is empty. `ADMIN_EMAILS` is an optional second allow-list. Admin writes must come from the same origin.

## Free-tier budget

- **Workers:** the static front page doesn't count. The JSON endpoints are well under 100k requests/day for personal use, and the edge cache keeps D1 reads tiny.
- **Workflows:** about 30 steps per run × 24 runs ≈ 720 steps/day (limit 3,000).
- **Workers AI** (limit 10,000 neurons/day): at most `maxEnrichPerRun` stories (default 40) are rewritten per run, in batches of 8. Once the backlog from the first run is cleared, each run handles only new or changed stories, typically 10–30, which is a few hundred neurons. Lower `maxEnrichPerRun` in settings if you add many sources.
- **D1:** articles and stories older than 7 days are deleted, and only the last 48 snapshots are kept.

## Development

```bash
pnpm install
cp .dev.vars.example .dev.vars   # skips Access locally
pnpm db:migrate:local
pnpm dev
```

Then trigger a refresh with `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=7+*+*+*+*"` or the button in `/admin`. The AI binding always calls Workers AI remotely, even in local dev.

```bash
pnpm test        # feed parsing, clustering, ranking, API formats, AI output validation
pnpm typecheck
```

## Deploying your own

1. Run `pnpm exec wrangler d1 create news-aggregator` and put the `database_id` in `wrangler.jsonc`.
2. Set the `routes` pattern and `SITE_URL` to your hostname, and `ADMIN_EMAILS`.
3. Run `pnpm run deploy`. It applies migrations, then deploys.
4. In Zero Trust → Access → Applications, add a self-hosted application for `your.host/admin` and `your.host/api/admin` with a policy for your email.
5. Put the application's AUD tag in `ACCESS_AUD` and your team domain in `ACCESS_TEAM_DOMAIN`, then deploy again.
6. Edit the starter sources and region labels in `/admin` to match where you live.

## License

MIT
