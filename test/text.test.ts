import assert from "node:assert/strict";
import { test } from "node:test";
import { asciiFold, canonicalUrl, decodeEntities, truncate } from "../src/text.ts";

test("asciiFold keeps text readable on displays without accents", () => {
  assert.equal(asciiFold("Oekraïne – “café” €5…"), 'Oekraine - "cafe" EUR5...');
});

test("canonicalUrl drops tracking parameters and fragments", () => {
  assert.equal(canonicalUrl("https://a.be/x?utm_source=rss&id=3#top"), "https://a.be/x?id=3");
});

test("decodeEntities handles numeric and named entities", () => {
  assert.equal(decodeEntities("&#233;&#x20AC;&amp;&eacute;"), "é€&é");
});

test("truncate cuts on a word boundary", () => {
  assert.equal(truncate("The quick brown fox jumps over the lazy dog", 20), "The quick brown fox…");
  assert.equal(truncate("short", 20), "short");
});
