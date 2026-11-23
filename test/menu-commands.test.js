import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import config from "../config/bot.config.js";
import theme from "../config/theme.config.js";
import { loadCommands } from "../handlers/command-loader.js";
import { applyMenuPlan } from "../src/damzd/menu-plan.js";
import { buildMenu } from "../lib/menu.js";

// The deployed v1.4.45 DamzD menu order, followed by our anime extras.
const expectedTitles = [
  "💬 ᴀɪ & ᴄʜᴀᴛ",
  "📢 ᴄʜᴀɴɴᴇʟ",
  "📥 ᴅᴏᴡɴʟᴏᴀᴅs",
  "🎮 ɢᴀᴍᴇs",
  "🎉 ғᴜɴ",
  "🤖 ɢᴇɴᴇʀᴀʟ",
  "👥 ɢʀᴏᴜᴘ",
  "🎨 ᴀɪ ᴍᴇᴅɪᴀ",
  "📰 ɴᴇᴡs",
  "👑 ᴏᴡɴᴇʀ",
  "🔒 ᴘʀɪᴠᴀᴄʏ",
  "📱 sᴛᴀᴛᴜs",
  "🛠 ᴛᴏᴏʟs",
  "🌸 ᴀɴɪᴍᴇ ɢɪғs",
  "🖼 ᴀɴɪᴍᴇ ɪᴍᴀɢᴇs",
  "🎴 ᴀɴɪᴍᴇ"
];

test("every merged command is registered without collisions", async () => {
  const { commands, lookup } = await loadCommands(path.resolve("commands"));
  const count = category => commands.filter(command => command.category === category).length;

  assert.equal(count("General"), 15); // + about, channel, channeljid, vcf
  assert.equal(count("AI & Chat"), 13); // + aidetect, grok (ai/ask are aliases now)
  assert.equal(count("AI Media"), 11); // + sora, voices, vn2text, ssweb
  assert.equal(count("News"), 15); // + france24, washingtonpost, timesofindia, abcnews
  assert.equal(count("Group"), 30); // + tldr, lore, roast, del
  assert.equal(count("Downloads"), 10); // + tiktok2 (yt/insta/song are renamed primaries)
  assert.equal(count("Games"), 12); // + rate, love, wcg
  assert.equal(count("Fun"), 22); // + quote, randomjoke, echo, quoted, react
  assert.equal(count("Channel"), 8);
  assert.equal(count("Privacy"), 20); // the v1.4.45 privacy set + antidel
  assert.equal(count("Status"), 18);
  assert.equal(count("Owner"), 2); // runtime + prefix
  assert.equal(count("Anime Info"), 16);
  assert.equal(count("Anime Rankings"), 11);
  assert.equal(count("Anime Random"), 4);
  assert.equal(count("Anime Tools"), 1);
  assert.equal(count("Anime Images"), 4);
  assert.equal(count("Anime GIFs"), 52);
  assert.equal(count("Canvas"), 2);
  assert.equal(count("Media & Tools"), 5);
  assert.equal(count("Chat & Privacy"), 1);
  assert.equal(count("Tools"), 9);
  assert.equal(commands.length, 281);

  // The old curated names keep working (renames became aliases).
  for (const name of [
    "menu", "help", "ping", "alive", "owner", "support", "time", "date", "version", "jid", "whoami",
    "ai", "ask", "claude", "gemini", "fable", "fable5", "gpt", "chatgpt", "mathgpt", "deepseek", "translate", "summarize", "qwen", "deepseek2", "grok", "aidetect",
    "flux", "pollination", "tts", "tts2", "tts3", "tts4", "tts5", "sora", "voices", "vn2text", "ssweb",
    "news", "aljazeera", "cnn", "bbc", "guardian", "npr", "nytimes", "foxnews", "skynews", "dw", "punchnews",
    "france24", "washingtonpost", "timesofindia", "abcnews",
    "welcome", "goodbye", "groupinfo", "groupjid", "getgcpp", "groupcount", "groupstats", "admins", "tagall", "link", "groupname", "groupdesc", "close", "open", "revoke", "resetlink", "kick", "remove", "add", "promote", "demote", "leave", "antilink", "warn", "warnlist", "tldr", "lore", "roast", "del",
    "gcstatus", "groupstatus", "gcstatusdm", "dmgcstatus", "autostatus", "autoview", "statusreact", "statusreacton", "statusreactmode", "statusreactkeys", "statusmention", "statusinfo",
    "typing", "recording", "autotype", "autorec", "online", "pres",
    "antidelete", "antidel", "antiedit", "unsend", "edit", "pin", "unpin", "archive", "unarchive", "mutechat", "unmutechat", "readchat", "unreadchat", "star", "unstar", "disappear", "block", "unblock", "forward", "banchecker", "pollres",
    "vv", "vv2", "sticker", "sendvv", "save", "tiktokstalk", "bible", "couplepp", "pp", "shortenurl", "removebg",
    "cfollow", "cunfollow", "channels", "cstatus", "cpost", "creact", "cvote", "msessions",
    "aio", "fb", "twitter", "instagram", "insta", "ytmp4", "yt", "tiktok", "tiktok2", "play2", "song", "ytsearch", "video",
    "calc", "poll", "coinflip", "dice", "8ball", "choose", "trivia", "riddle", "activity", "rate", "love", "wcg", "pokemon",
    "joke", "dadjoke", "progjoke", "chuck", "fact2", "catfact", "dog", "cat", "fox", "advice", "quote", "quote2", "quoted", "randomjoke", "echo", "react", "meme", "numfact", "history", "wiki", "nasa",
    "about", "channel", "channeljid", "vcf", "prefix",
    "animemenu", "anime", "manga", "character", "charpic", "staff", "studio", "recommend", "episodes", "animechars", "trailer", "pictures", "streaming", "review", "genres", "genre",
    "topanime", "topmanga", "popular", "favorite", "airing", "upcoming", "trending", "season", "topchars", "schedule", "nextep",
    "randomanime", "randommanga", "randomchar", "animequote", "whatanime", "waifu2", "husbando", "neko", "kitsune",
    "angry", "baka", "yeet", "wndwqute", "canvasquote", "lyrics", "privacy", "statusdraft", "statusideas", "runtime", "ggs", "vvinfo"
  ]) {
    assert.ok(lookup.has(name), "missing command or alias " + name);
  }
});

test("abusive and fake-message commands stay unregistered", async () => {
  const { lookup } = await loadCommands(path.resolve("commands"));
  for (const name of [
    "addmeta", "removemeta", "fakemsg", "readreceipt",
    "fakettc", "meme2", "fakeff", "fakeffduo", "ffgirl",
    "kick2", "bite", "bonk", "shoot", "slap", "tableflip"
  ]) {
    assert.equal(lookup.has(name), false, "excluded command was registered: " + name);
  }
  assert.equal(lookup.get("punch")?.category, "News", "the short Punch Nigeria news alias must remain a news command");
});

test("all 16 sections appear in the deployed DamzD order with nothing hidden", async () => {
  const { commands } = await loadCommands(path.resolve("commands"));
  applyMenuPlan(commands);
  const menu = buildMenu({ commands, config, theme });
  const positions = expectedTitles.map(title => menu.indexOf(title));

  assert.equal(theme.sections.length, 16);
  assert.ok(positions.every(position => position >= 0), "a section title is missing from the menu");
  assert.ok(positions.every((position, index) => index === 0 || positions[index - 1] < position),
    "section order changed");
  assert.ok(menu.includes("📢 ᴄʜᴀɴɴᴇʟ"), "the Channel section must be shown");
  assert.ok(menu.includes("🔒 ᴘʀɪᴠᴀᴄʏ"), "the Privacy section must be shown");
  assert.equal(commands.filter(command => command.hidden).length, 0, "no command may be hidden");
  for (const command of [
    "menu", "ping", "news", "groupinfo", "aio", "joke", "trivia", "chatgpt", "lyrics", "privacy", "ggs", "ghost", "song",
    "cfollow", "unsend", "sticker", "statusreact", "tldr", "wcg", "vn2text", "prefix"
  ]) {
    assert.ok(menu.includes(config.prefix + command), "menu does not display " + command);
  }
  // Every command name appears exactly once on the menu (no duplicates).
  const rows = menu.split("\n").filter(line => line.startsWith("│  › ." + config.prefix));
  const shown = menu.split("\n").filter(line => line.includes("│  › ."));
  assert.equal(rows.length, 0, "double prefix rows must not exist");
  assert.equal(shown.length, commands.length, "menu rows and loaded commands must match");
});

test("uses the DamzD identity: artwork, dashboard link, neutral channel and single owner", () => {
  assert.equal(config.name, "DamzD");
  assert.equal(config.ownerName, "DamzD");
  assert.equal(config.ownerNumber, "2348000000000");
  assert.deepEqual(Array.from(config.ownerNumbers), ["2348000000000"]);
  assert.equal(config.ownerNumbers.length, 1);
  assert.equal(config.channel.name, "ᴅᴀᴍᴢᴅ");
  assert.equal(config.channel.jid, "");
  assert.equal(config.imageUrl, "https://res.cloudinary.com/dqqyvozdw/image/upload/v1792848652/arbeimjfqkkfpn9zvfhf.png");
  assert.equal(config.botUrl, "");
});

test("the menu sends official artwork and still includes the complete text menu", async () => {
  const { commands } = await loadCommands(path.resolve("commands"));
  const menuCommand = commands.find(command => command.name === "menu");
  const sent = [];
  const ctx = {
    config,
    theme,
    commands,
    send: async payload => sent.push({ type: "media", payload }),
    reply: async payload => sent.push({ type: "text", payload })
  };

  await menuCommand.run(ctx);
  assert.equal(sent[0].type, "media");
  assert.equal(sent[0].payload.image.url, config.imageUrl);
  assert.ok(sent[0].payload.caption.includes("POWERED BY GREAT DAMZD"));
  assert.equal(sent[1].type, "text");
  assert.ok(sent[1].payload.includes("💬 ᴀɪ & ᴄʜᴀᴛ"));
  assert.ok(sent[1].payload.includes("👑 ᴏᴡɴᴇʀ"));
  assert.ok(sent[1].payload.includes("📢 ᴄʜᴀɴɴᴇʟ"));
});
