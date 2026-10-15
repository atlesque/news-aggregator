-- Duplicate detection now embeds an English one-line gist of each story, and the prompt fixes the
-- language to the first report's. Redo recent rewrites so their vectors and languages match.
UPDATE stories SET dirty = 1, enriched_at = NULL
  WHERE headline IS NOT NULL AND last_published_at > (strftime('%s', 'now') - 48 * 3600) * 1000;
