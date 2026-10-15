-- HLN's feed answers Cloudflare Workflows with HTTP 403, so read HLN Brugge through Bing
-- News. Also add Krant van West-Vlaanderen (KW) for more Bruges coverage.
UPDATE sources SET module = 'bing-news', etag = NULL, last_modified = NULL,
  config = '{"query":"site:hln.be/brugge","market":"nl-BE","excludeKeywords":["voetbal","Club Brugge","Cercle Brugge"]}'
  WHERE module = 'rss' AND name = 'HLN Brugge';
INSERT INTO sources (module, name, config, regions, created_at, updated_at) VALUES
  ('bing-news', 'KW Brugge', '{"query":"site:kw.be Brugge","market":"nl-BE","excludeKeywords":["voetbal","Club Brugge","Cercle Brugge"]}', '["local"]', 0, 0);
