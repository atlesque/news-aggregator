import assert from "node:assert/strict";
import { test } from "node:test";
import { asciiFold, canonicalUrl, decodeEntities, detectLang, truncate } from "../src/text.ts";

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

test("detectLang tells Dutch from English and stays quiet when unsure", () => {
  assert.equal(detectLang("Elon Musk suggereert Amerikaanse betrokkenheid bij Starlink. Volgens Musk wordt de werking van het netwerk in Oekraïne beperkt door de overheid."), "nl");
  assert.equal(detectLang("Two people die from West Nile virus in Flanders after a mosquito bite was confirmed by the authorities."), "en");
  assert.equal(detectLang("Brugge"), null);
});
