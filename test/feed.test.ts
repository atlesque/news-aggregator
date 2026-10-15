import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFeed } from "../src/feed.ts";

test("parses RSS 2.0 with CDATA, entities and media images", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title><![CDATA[Brand in Brugse binnenstad &amp; omgeving]]></title>
      <link>https://www.hln.be/brugge/brand~a1/?utm_source=rss</link>
      <description>&lt;p&gt;De brandweer was &lt;b&gt;snel&lt;/b&gt; ter plaatse.&lt;/p&gt;</description>
      <pubDate>Wed, 15 Oct 2026 08:00:00 GMT</pubDate>
      <category>Brugge</category>
      <media:content url="https://img.example/a.jpg" medium="image"/></item>
    <item><title>No link</title></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Brand in Brugse binnenstad & omgeving");
  assert.equal(items[0].summary, "De brandweer was snel ter plaatse.");
  assert.equal(items[0].publishedAt, Date.parse("2026-10-15T08:00:00Z"));
  assert.equal(items[0].image, "https://img.example/a.jpg");
  assert.deepEqual(items[0].categories, ["Brugge"]);
});

test("parses Atom with alternate links and extra category tags", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:vrtns="http://base.vrt.be"><title>VRT</title>
    <entry><title type="text">Oekraïne valt raffinaderijen aan</title><id>x</id>
      <published>2026-10-15T10:12:00.000Z</published><summary type="text">Kort.</summary>
      <vrtns:nstag xmlns="">Europa</vrtns:nstag>
      <link href="https://www.vrt.be/x.rss.xml" rel="self" type="application/atom+xml"></link>
      <link href="https://vrtnws.be/p.abc" rel="alternate" type="text/html"></link>
      <link href="https://images.vrt.be/a.jpg" rel="enclosure" type="image/jpeg"></link></entry></feed>`;
  const [item] = parseFeed(xml, 10, ["vrtns:nstag"]);
  assert.equal(item.url, "https://vrtnws.be/p.abc");
  assert.equal(item.title, "Oekraïne valt raffinaderijen aan");
  assert.deepEqual(item.categories, ["Europa"]);
  assert.equal(item.image, "https://images.vrt.be/a.jpg");
});

test("reads the Google News <source> publisher", () => {
  const xml = `<rss><channel><item><title>Shipping company sells tanker - Belga News Agency</title>
    <link>https://news.google.com/rss/articles/abc?oc=5</link><guid isPermaLink="false">abc</guid>
    <pubDate>Tue, 13 Oct 2026 12:22:30 GMT</pubDate><source url="https://www.belganewsagency.eu">Belga News Agency</source></item></channel></rss>`;
  const [item] = parseFeed(xml);
  assert.equal(item.publisher, "Belga News Agency");
  assert.equal(item.url, "https://news.google.com/rss/articles/abc?oc=5");
});

test("respects maxItems", () => {
  const xml = `<rss><channel>${Array.from({ length: 10 }, (_, i) => `<item><title>T${i}</title><link>https://e.x/${i}</link></item>`).join("")}</channel></rss>`;
  assert.equal(parseFeed(xml, 3).length, 3);
});

test("picks the widest image when a feed lists several", () => {
  const xml = `<rss><channel><item><title>T</title><link>https://e.x/1</link>
    <media:content width="140" url="https://img.x/small.jpg"/><media:content width="460" url="https://img.x/big.jpg"/></item></channel></rss>`;
  assert.equal(parseFeed(xml)[0].image, "https://img.x/big.jpg");
});
