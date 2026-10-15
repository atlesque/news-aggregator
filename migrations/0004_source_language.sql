-- Headlines and summaries now stay in the language of their source articles instead of being
-- translated to English. Record that language, and queue existing rewrites to be redone.
ALTER TABLE stories ADD COLUMN lang TEXT;
UPDATE stories SET dirty = 1, enriched_at = NULL WHERE headline IS NOT NULL;
