import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuery, renderCompact, selectStories } from "../src/formats.ts";
import { parseEnrichment } from "../src/enrich.ts";
import { buildSnapshot, type StoryInput } from "../src/rank.ts";
import { isRefreshTime, nextRefresh } from "../src/schedule.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const now = Date.parse("2026-10-15T12:30:00Z");
const TWO = [{ name: "a", url: "x" }, { name: "b", url: "y" }];
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
      story(3, { breaking: true, sources: TWO }),
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
  assert.equal(snap.stories[0].priority, "high");
  // High priority, but only one outlet has it: not marked important.
  assert.equal(snap.stories[1].priority, "medium");
});

test("breaking only shows within six hours of the first report", () => {
  const snap = buildSnapshot(
    [story(1, { breaking: true, priority: 3, sources: TWO, firstPublishedAt: now - 7 * 3_600_000, lastPublishedAt: now - 600_000 })],
    DEFAULT_SETTINGS,
    now,
  );
  assert.equal(snap.stories[0].breaking, false);
  assert.equal(snap.stories[0].priority, "high");
});

test("breaking needs a second outlet", () => {
  const snap = buildSnapshot([story(1, { breaking: true, priority: 3 })], DEFAULT_SETTINGS, now);
  assert.equal(snap.stories[0].breaking, false);
  assert.equal(snap.stories[0].priority, "medium");
});

test("a second outlet merged in at publish time counts", () => {
  const vec = new Float32Array([1, 0, 0]);
  const snap = buildSnapshot(
    [story(1, { priority: 3, vec }), story(2, { region: "national", vec, sources: [{ name: "HLN", url: "https://e.x/b" }] })],
    DEFAULT_SETTINGS,
    now,
  );
  assert.equal(snap.stories.length, 1);
  assert.equal(snap.stories[0].priority, "high");
});

test("at most four important and two breaking stories, best first", () => {
  const stories = Array.from({ length: 8 }, (_, i) =>
    story(i + 1, { priority: 3, breaking: true, sources: TWO, lastPublishedAt: now - i * 600_000 }),
  );
  const settings = { ...DEFAULT_SETTINGS, quotas: { local: 10, national: 0, europe: 0, world: 0 } };
  const snap = buildSnapshot(stories, settings, now);
  assert.deepEqual(snap.stories.filter((s) => s.priority === "high").map((s) => s.id), [1, 2, 3, 4]);
  assert.deepEqual(snap.stories.filter((s) => s.breaking).map((s) => s.id), [1, 2]);
});

test("refreshes at 6, 12, 16 and 20 Brussels time, summer and winter", () => {
  const iso = (t: number) => new Date(t).toISOString();
  // Summer time (UTC+2): 12:30 UTC is 14:30 in Brussels, so next is 16:07 = 14:07 UTC.
  assert.equal(iso(nextRefresh(now)), "2026-10-15T14:10:00.000Z");
  // After 20:07 the next one is 6:07 the next morning.
  assert.equal(iso(nextRefresh(Date.parse("2026-10-15T18:30:00Z"))), "2026-10-16T04:10:00.000Z");
  // Across the DST change on 25 October, 6:07 Brussels is 5:07 UTC.
  assert.equal(iso(nextRefresh(Date.parse("2026-10-24T18:30:00Z"))), "2026-10-25T05:10:00.000Z");
  // Each cron hour fires twice a day per time; only the right one runs.
  assert.ok(isRefreshTime(Date.parse("2026-10-16T04:07:00Z")));
  assert.ok(!isRefreshTime(Date.parse("2026-10-16T05:07:00Z")));
  assert.ok(isRefreshTime(Date.parse("2026-12-01T05:07:00Z")));
  assert.ok(!isRefreshTime(Date.parse("2026-12-01T04:07:00Z")));
  const winter = [4, 5, 10, 11, 14, 15, 18, 19].filter((h) => isRefreshTime(Date.UTC(2026, 11, 1, h, 7)));
  const summer = [4, 5, 10, 11, 14, 15, 18, 19].filter((h) => isRefreshTime(Date.UTC(2026, 6, 1, h, 7)));
  assert.deepEqual(winter, [5, 11, 15, 19]);
  assert.deepEqual(summer, [4, 10, 14, 18]);
});

test("API filters and compact output", () => {
  const snap = buildSnapshot([story(1, { priority: 3, headline: "Oekraïne", sources: TWO }), story(2, { priority: 1 })], DEFAULT_SETTINGS, now);
  const q = parseQuery(new URLSearchParams("minPriority=high&ascii=1&format=compact&region=local,bogus"));
  assert.deepEqual(q.regions, ["local"]);
  const picked = selectStories(snap, q);
  assert.equal(picked.length, 1);
  const out = JSON.parse(renderCompact(snap, picked));
  assert.equal(out.i[0].l, undefined);
  assert.equal(out.i[0].h, "Oekraine");
  assert.equal(out.i[0].p, 3);
});

test("AI output is validated against the story's allowed regions", () => {
  const inputs = [{ id: 7, allowedRegions: ["local" as const], articles: [] }];
  const text = '```json\n{"stories":[{"id":7,"headline":"Fire in Bruges!","summary":"s","region":"world","topic":"nonsense","priority":"high","breaking":false,"newsworthy":true,"lang":"NL","gist_en":"A fire broke out in Bruges."},{"id":99,"headline":"x"}]}\n```';
  const [o, ...rest] = parseEnrichment(text, inputs);
  assert.equal(rest.length, 0);
  assert.equal(o.region, "local");
  assert.equal(o.topic, "other");
  assert.equal(o.priority, 3);
  assert.equal(o.headline, "Fire in Bruges");
  assert.equal(o.lang, "nl");
  assert.equal(o.gist, "A fire broke out in Bruges.");
});

test("source-language mode tells the model not to translate", async () => {
  const { systemPrompt } = await import("../src/enrich.ts");
  assert.match(systemPrompt(DEFAULT_SETTINGS), /language of the story's first listed article/);
  assert.match(systemPrompt({ ...DEFAULT_SETTINGS, language: "en" }), /headline: in English/);
});

test("story language is carried into the snapshot and compact output", () => {
  const snap = buildSnapshot([story(1, { lang: "nl" })], DEFAULT_SETTINGS, now);
  assert.equal(snap.stories[0].lang, "nl");
  assert.equal(JSON.parse(renderCompact(snap, snap.stories)).i[0].l, "nl");
});
