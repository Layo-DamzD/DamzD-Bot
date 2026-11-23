import { POWERED_FOOTER, unicodeBox } from "../lib/api-client.js";

export const NEWS_SOURCES = Object.freeze({
  aj: { name: "Al Jazeera", feedUrl: "https://www.aljazeera.com/xml/rss/all.xml", homeUrl: "https://www.aljazeera.com", aliases: ["aljazeera", "al-jazeera"] },
  cnn: { name: "CNN", feedUrl: "https://rss.cnn.com/rss/edition.rss", homeUrl: "https://edition.cnn.com", aliases: [] },
  bbc: { name: "BBC News", feedUrl: "https://feeds.bbci.co.uk/news/rss.xml", homeUrl: "https://www.bbc.com/news", aliases: [] },
  gd: { name: "The Guardian", feedUrl: "https://www.theguardian.com/world/rss", homeUrl: "https://www.theguardian.com", aliases: ["guardian"] },
  npr: { name: "NPR", feedUrl: "https://feeds.npr.org/1001/rss.xml", homeUrl: "https://www.npr.org/sections/news/", aliases: [] },
  nyt: { name: "New York Times", feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", homeUrl: "https://www.nytimes.com", aliases: ["nytimes"] },
  fox: { name: "Fox News", feedUrl: "https://moxie.foxnews.com/google-publisher/latest.xml", homeUrl: "https://www.foxnews.com", aliases: ["foxnews"] },
  sky: { name: "Sky News", feedUrl: "https://feeds.skynews.com/feeds/rss/home.xml", homeUrl: "https://news.sky.com", aliases: ["skynews"] },
  dw: { name: "DW", feedUrl: "https://rss.dw.com/rdf/rss-en-all", homeUrl: "https://www.dw.com/en/", aliases: [] },
  f24: { name: "France 24", feedUrl: "https://www.france24.com/en/rss", homeUrl: "https://www.france24.com/en/", aliases: ["france24"] },
  wp: { name: "Washington Post", feedUrl: "https://feeds.washingtonpost.com/rss/world", homeUrl: "https://www.washingtonpost.com", aliases: ["washingtonpost", "wapo"] },
  toi: { name: "Times of India", feedUrl: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", homeUrl: "https://timesofindia.indiatimes.com", aliases: ["timesofindia"] },
  punch: { name: "Punch Nigeria", feedUrl: "https://punchng.com/feed/", homeUrl: "https://punchng.com", aliases: ["punchng"] },
  abc: { name: "ABC News (US)", feedUrl: "https://abcnews.go.com/abcnews/topstories", homeUrl: "https://abcnews.go.com", aliases: ["abcnews"] }
});

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 3000;
const sourceLookup = new Map();

for (const [code, source] of Object.entries(NEWS_SOURCES)) {
  sourceLookup.set(code, code);
  sourceLookup.set(source.name.toLowerCase(), code);
  for (const alias of source.aliases) sourceLookup.set(alias, code);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => {
      const code = Number.parseInt(digits, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#(\d+);/g, (_, digits) => {
      const code = Number.parseInt(digits, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

export function cleanNewsText(value, limit = 260) {
  let text = decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > limit) text = text.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
  return text;
}

function tagContent(block, name) {
  const pattern = new RegExp(
    "<(?:[\\w.-]+:)?" + name + "\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + "\\s*>",
    "i"
  );
  return String(block || "").match(pattern)?.[1] || "";
}

function getTagText(block, names, limit) {
  for (const name of names) {
    const value = cleanNewsText(tagContent(block, name), limit);
    if (value) return value;
  }
  return "";
}

function articleLink(block, baseUrl) {
  const rssText = getTagText(block, ["link"], 1000);
  if (rssText) {
    try {
      const url = new URL(decodeEntities(rssText), baseUrl);
      if (["https:", "http:"].includes(url.protocol)) return url.href;
    } catch {}
  }

  const atom = String(block || "").match(/<(?:[\w.-]+:)?link\b([^>]*?)\/?\s*>/i);
  const href = atom?.[1]?.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!href) return "";
  try {
    const url = new URL(decodeEntities(href), baseUrl);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function parseNewsFeed(content, baseUrl, limit = 5) {
  const xml = String(content || "");
  const entries = xml.match(/<(?:[\w.-]+:)?(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?(?:item|entry)\s*>/gi) || [];
  const articles = [];
  const seen = new Set();

  for (const entry of entries) {
    const title = getTagText(entry, ["title"], 200);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    articles.push({
      title,
      summary: getTagText(entry, ["description", "summary", "encoded", "content"], 260),
      date: getTagText(entry, ["pubDate", "published", "updated", "date"], 80),
      link: articleLink(entry, baseUrl)
    });
    if (articles.length >= limit) break;
  }
  return articles;
}

async function fetchNews(source, count) {
  let response;
  try {
    response = await fetch(source.feedUrl, {
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "user-agent": "FEI-XMD-News/1.0 (+https://github.com/Benfeitech/FEI-XMD)"
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow"
    });
  } catch {
    throw new Error("The news feed could not be reached.");
  }

  if (!response.ok) throw new Error("The news feed returned HTTP " + response.status + ".");
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_FEED_BYTES) throw new Error("The news feed was too large.");

  const xml = await response.text();
  if (xml.length > MAX_FEED_BYTES) throw new Error("The news feed was too large.");
  const articles = parseNewsFeed(xml, source.feedUrl, count);
  if (!articles.length) throw new Error("No readable headlines were found.");
  return articles;
}

function sourceMenu(prefix) {
  const sources = Object.entries(NEWS_SOURCES)
    .map(([code, source]) => "• *" + code + "* — " + source.name);
  return unicodeBox("📰 NEWS SOURCES", [
    ...sources,
    "",
    "Usage: " + prefix + "news bbc 5",
    "All sources: " + prefix + "news all 1",
    "Individual source shortcuts are also available for selected publishers."
  ].join("\n"), { footer: true });
}

function articleBlock(article, index, withSummary = true) {
  const lines = ["*" + index + ". " + article.title + "*"];
  if (article.date) lines.push("🕒 _" + article.date + "_");
  if (withSummary && article.summary && article.summary.toLowerCase() !== article.title.toLowerCase()) {
    lines.push(article.summary);
  }
  if (article.link) lines.push("🔗 " + article.link);
  return lines.join("\n");
}

function chunkBlocks(blocks) {
  const messages = [];
  let current = "📰 *LATEST NEWS*\n";
  for (const block of blocks) {
    const addition = "\n\n" + block;
    if (current.length + addition.length > MAX_MESSAGE_CHARS && current.trim()) {
      messages.push(current.trim());
      current = block;
    } else {
      current += addition;
    }
  }
  if (current.trim()) messages.push(current.trim());
  if (!messages.length) messages.push("No headlines were returned.");
  messages[messages.length - 1] += "\n\n" + POWERED_FOOTER;
  return messages;
}

async function runNews(ctx, fixedCode = "") {
  const tokens = String(ctx.args || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const selector = fixedCode || tokens[0] || "";
  if (!selector || ["help", "menu", "list", "sources"].includes(selector)) {
    await ctx.reply(sourceMenu(ctx.config.prefix));
    return;
  }

  const all = selector === "all";
  const code = sourceLookup.get(selector);
  if (!all && !code) {
    await ctx.reply("Unknown news source. Use " + ctx.config.prefix + "news to see the source list.");
    return;
  }

  const countToken = fixedCode ? tokens[0] : tokens[1];
  const count = countToken === undefined ? (all ? 1 : 5) : Number(countToken);
  const max = all ? 2 : 10;
  if (!Number.isInteger(count) || count < 1 || count > max) {
    await ctx.reply("Choose a count from 1 to " + max + ".");
    return;
  }

  await ctx.reply("📰 Fetching the latest headlines...");
  if (!all) {
    const source = NEWS_SOURCES[code];
    try {
      const articles = await fetchNews(source, count);
      const blocks = ["*" + source.name.toUpperCase() + "*"];
      articles.forEach((article, index) => blocks.push(articleBlock(article, index + 1)));
      for (const chunk of chunkBlocks(blocks)) await ctx.reply(chunk);
    } catch (error) {
      await ctx.reply("⚠️ " + source.name + " headlines are temporarily unavailable. " + String(error?.message || ""));
    }
    return;
  }

  const selected = Object.entries(NEWS_SOURCES);
  let cursor = 0;
  const results = new Array(selected.length);
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= selected.length) return;
      const [sourceCode, source] = selected[index];
      try {
        results[index] = { sourceCode, source, articles: await fetchNews(source, count) };
      } catch {
        results[index] = { sourceCode, source, articles: [] };
      }
    }
  });
  await Promise.all(workers);

  const blocks = [];
  let total = 0;
  for (const result of results) {
    if (!result.articles.length) {
      blocks.push("⚠️ *" + result.source.name + "* (" + result.sourceCode + "): unavailable.");
      continue;
    }
    total += result.articles.length;
    blocks.push("*" + result.source.name.toUpperCase() + "*");
    result.articles.forEach((article, index) => blocks.push(articleBlock(article, index + 1, false)));
  }
  if (!total) {
    await ctx.reply("⚠️ None of the configured news feeds are responding right now.");
    return;
  }
  blocks.unshift("_Retrieved " + total + " headlines from " + results.filter(item => item.articles.length).length + " sources._");
  for (const chunk of chunkBlocks(blocks)) await ctx.reply(chunk);
}

const shortcuts = [
  ["aljazeera", "aj", ["aj"]],
  ["cnn", "cnn", []],
  ["bbc", "bbc", []],
  ["guardian", "gd", ["gd"]],
  ["npr", "npr", []],
  ["nytimes", "nyt", ["nyt"]],
  ["foxnews", "fox", []],
  ["skynews", "sky", ["sky"]],
  ["dw", "dw", []],
  ["punchnews", "punch", ["punch", "punchng"]]
];

export default [
  {
    name: "news",
    aliases: ["n"],
    category: "News",
    description: "Fetch current headlines from 14 international and Nigerian news feeds.",
    run: ctx => runNews(ctx)
  },
  ...shortcuts.map(([name, sourceCode, aliases]) => ({
    name,
    aliases,
    category: "News",
    description: "Fetch the latest headlines from " + NEWS_SOURCES[sourceCode].name + ".",
    run: ctx => runNews(ctx, sourceCode)
  }))
];
