-- A second "already ingested?" key next to the URL hash: outlet host + headline words (see
-- dedupKey in src/text.ts). Existing rows are filled in by the next refresh.
ALTER TABLE articles ADD COLUMN dedup_key TEXT;
CREATE INDEX articles_dedup ON articles (dedup_key);

-- Each story's picture, copied into R2 (the IMAGES bucket) so it no longer depends on hotlinking.
-- image keeps the original URL; image_key is the R2 object; image_width its measured width.
-- image_checked_articles is the article count when images were last looked for: a story is
-- looked at again only when new articles join it and its picture is still missing or small.
ALTER TABLE stories ADD COLUMN image_key TEXT;
ALTER TABLE stories ADD COLUMN image_width INTEGER;
ALTER TABLE stories ADD COLUMN image_checked_articles INTEGER NOT NULL DEFAULT 0;
