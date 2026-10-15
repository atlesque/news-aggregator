-- All timestamps are Unix milliseconds.

-- A configured instance of a source module (src/sources/). `config` is the module's own
-- parameters; `regions` lists the regions stories from this source may be filed under.
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  regions TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  etag TEXT,
  last_modified TEXT,
  last_fetch_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  last_new INTEGER
);

-- One fetched item. id is a hash of the canonical URL, so refetches are ignored.
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  image TEXT,
  hint TEXT,
  published_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  story_id INTEGER
);
CREATE INDEX articles_unclustered ON articles (fetched_at) WHERE story_id IS NULL;
CREATE INDEX articles_story ON articles (story_id);
CREATE INDEX articles_published ON articles (published_at);

-- A deduplicated story: one or more articles about the same event, with the AI's rewrite.
-- `centroid` is the embedding (Float32, unit length) of its first article; new articles join
-- the story whose centroid they are most similar to.
CREATE TABLE stories (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  first_published_at INTEGER NOT NULL,
  last_published_at INTEGER NOT NULL,
  centroid BLOB,
  article_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  -- Set when articles were added since the last AI pass.
  dirty INTEGER NOT NULL DEFAULT 1,
  enriched_at INTEGER,
  headline TEXT,
  summary TEXT,
  region TEXT,
  topic TEXT,
  priority INTEGER,
  breaking INTEGER NOT NULL DEFAULT 0,
  newsworthy INTEGER NOT NULL DEFAULT 1,
  image TEXT,
  ai_model TEXT,
  -- Embedding of the rewritten headline and summary: a second, same-language duplicate check.
  headline_vec BLOB,
  -- Admin overrides.
  hidden INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX stories_dirty ON stories (dirty, last_published_at);
CREATE INDEX stories_recent ON stories (last_published_at);

CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  stats TEXT,
  error TEXT
);
CREATE INDEX runs_started ON runs (started_at);

-- Overrides for the defaults in src/settings.ts.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The published front page, rebuilt at the end of every refresh.
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  json TEXT NOT NULL
);

-- Starter sources, focused on Bruges. Edit or add more in /admin.
INSERT INTO sources (module, name, config, regions, created_at, updated_at) VALUES
  ('vrt-nws', 'VRT NWS', '{"language":"nl","excludeTags":["Podiumtip"]}', '["national","europe","world"]', 0, 0),
  ('rss', 'HLN Brugge', '{"url":"https://www.hln.be/brugge/rss.xml","excludeKeywords":["voetbal","Club Brugge","Cercle Brugge"]}', '["local"]', 0, 0),
  ('google-news', 'Google News: Brugge', '{"query":"Brugge nieuws -voetbal -\"Club Brugge\"","language":"nl","country":"BE"}', '["local"]', 0, 0),
  ('google-news', 'Focus-WTV', '{"query":"site:focus-wtv.be Brugge -voetbal","language":"nl","country":"BE"}', '["local"]', 0, 0),
  ('google-news', 'Belga News Agency', '{"query":"site:belganewsagency.eu","language":"en","country":"BE"}', '["national"]', 0, 0),
  ('google-news', 'The Brussels Times', '{"query":"site:brusselstimes.com","language":"en","country":"BE","maxItems":25}', '["national","europe"]', 0, 0),
  ('rss', 'Euronews', '{"url":"https://www.euronews.com/rss?level=theme&name=news","maxItems":30}', '["europe","world"]', 0, 0),
  ('rss', 'Politico Europe', '{"url":"https://www.politico.eu/feed/"}', '["europe"]', 0, 0),
  ('rss', 'BBC World', '{"url":"https://feeds.bbci.co.uk/news/world/rss.xml"}', '["world","europe"]', 0, 0),
  ('rss', 'The Guardian World', '{"url":"https://www.theguardian.com/world/rss","maxItems":25}', '["world","europe"]', 0, 0);
