import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuery, renderCompact, selectStories } from "../src/formats.ts";
import { parseEnrichment } from "../src/enrich.ts";
import { buildSnapshot, nextRefresh, type StoryInput } from "../src/rank.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const now = Date.parse("2026-10-15T12:30:00Z");
const story = (id: number, o: Partial<StoryInput> = {}): StoryInput => ({
  id, headline: `Story ${id}`, summary: `Summary ${id}`, region: "local", topic: "society", priority: 2, breaking: false, pinned: false,
  firstPublishedAt: now - 3_600_000, lastPublishedAt: now - 3_600_000, image: null, sources: [{ name: "VRT NWS", url: `https://e.x/${id}` }], ...o,
});

test("snapshot ranks by priority, breaking and coverage, and applies region quotas", () => {
  const settings = { ...DEFAULT_SETTINGS, quotas: { local: 2, national: 1, europe: 0, world: 1 } };
  const snap = buildSnapshot(
    [
      story(1, { priority: 1 }),
      story(2, { priority: 3 }),
      story(3, { breaking: true }),
      story(4),
      story(5, { region: "europe", priority: 3 }),
      story(6, { region: "national", sources: [{ name: "a", url: "x" }, { name: "b", url: "y" }] }),
      story(7, { region: "world", lastPublishedAt: now - 50 * 3_600_000 }),
    ],
    settings,
    now,
  );
  assert.deepEqual(snap.stories.map((s) => s.id), [3, 2, 6]);
  assert.equal(snap.stories[0].breaking, true);
});

test("breaking expires after six hours", () => {
  const snap = buildSnapshot([story(1, { breaking: true, lastPublishedAt: now - 7 * 3_600_000 })], DEFAULT_SETTINGS, now);
  assert.equal(snap.stories[0].breaking, false);
});

test("next refresh is a few minutes after the next :07", () => {
  assert.equal(new Date(nextRefresh(now)).toISOString(), "2026-10-15T13:10:00.000Z");
});

test("API filters and compact output", () => {
  const snap = buildSnapshot([story(1, { priority: 3, headline: "Oekraïne" }), story(2, { priority: 1 })], DEFAULT_SETTINGS, now);
  const q = parseQuery(new URLSearchParams("minPriority=high&ascii=1&format=compact&region=local,bogus"));
  assert.deepEqual(q.regions, ["local"]);
  const picked = selectStories(snap, q);
  assert.equal(picked.length, 1);
  const out = JSON.parse(renderCompact(snap, picked));
  assert.equal(out.i[0].h, "Oekraine");
  assert.equal(out.i[0].p, 3);
});

test("AI output is validated against the story's allowed regions", () => {
  const inputs = [{ id: 7, allowedRegions: ["local" as const], articles: [] }];
  const text = '```json\n{"stories":[{"id":7,"headline":"Fire in Bruges!","summary":"s","region":"world","topic":"nonsense","priority":"high","breaking":false,"newsworthy":true},{"id":99,"headline":"x"}]}\n```';
  const [o, ...rest] = parseEnrichment(text, inputs);
  assert.equal(rest.length, 0);
  assert.equal(o.region, "local");
  assert.equal(o.topic, "other");
  assert.equal(o.priority, 3);
  assert.equal(o.headline, "Fire in Bruges");
});
