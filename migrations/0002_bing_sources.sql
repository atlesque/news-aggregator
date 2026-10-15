-- Google News answers requests from Cloudflare's network with HTTP 503, so the searches move
-- to Bing News. Bing ignores "-word" exclusions, so those become excludeKeywords.
UPDATE sources SET module = 'bing-news', name = 'Bing News: Brugge',
  config = '{"query":"Brugge","market":"nl-BE","excludeKeywords":["voetbal","Club Brugge","Cercle Brugge","Jupiler"]}'
  WHERE module = 'google-news' AND name = 'Google News: Brugge';
UPDATE sources SET module = 'bing-news',
  config = '{"query":"site:focus-wtv.be","market":"nl-BE","excludeKeywords":["voetbal","Club Brugge","Cercle Brugge"]}'
  WHERE module = 'google-news' AND name = 'Focus-WTV';
UPDATE sources SET module = 'bing-news',
  config = '{"query":"site:brusselstimes.com","market":"en-GB"}'
  WHERE module = 'google-news' AND name = 'The Brussels Times';
-- Belga has no feed reachable from Cloudflare. Kept, disabled, for a future module.
UPDATE sources SET enabled = 0 WHERE module = 'google-news' AND name = 'Belga News Agency';
UPDATE sources SET etag = NULL, last_modified = NULL;
