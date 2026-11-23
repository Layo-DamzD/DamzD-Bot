import test from "node:test";
import assert from "node:assert/strict";

import {
  NEWS_SOURCES,
  cleanNewsText,
  parseNewsFeed
} from "../commands/news.js";

test("cleans RSS text and decodes common XML entities", () => {
  assert.equal(cleanNewsText("<b>Latest</b> &amp; breaking news"), "Latest & breaking news");
});

test("parses RSS items into safe headline records", () => {
  const xml = [
    "<rss><channel>",
    "<item><title><![CDATA[Headline One &amp; More]]></title>",
    "<description><![CDATA[<p>A short summary.</p>]]></description>",
    "<pubDate>Mon, 09 Nov 2026 09:00:00 GMT</pubDate>",
    "<link>https://news.example.com/story/1</link></item>",
    "<item><title>Headline Two</title><link>https://news.example.com/story/2</link></item>",
    "</channel></rss>"
  ].join("");

  const articles = parseNewsFeed(xml, "https://news.example.com/feed.xml", 5);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, "Headline One & More");
  assert.equal(articles[0].summary, "A short summary.");
  assert.equal(articles[0].link, "https://news.example.com/story/1");
  assert.equal(articles[1].title, "Headline Two");
});

test("all configured news feeds use HTTPS", () => {
  for (const source of Object.values(NEWS_SOURCES)) {
    assert.equal(new URL(source.feedUrl).protocol, "https:");
  }
});
