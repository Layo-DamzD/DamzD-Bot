import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import config from "../config/bot.config.js";
import { loadCommands } from "../handlers/command-loader.js";
import { applyMenuPlan } from "../src/damzd/menu-plan.js";
import { botImagePayload } from "../src/bot-image.js";

// v2.2.0 — the owner's cleanup release. The anime section (anime-v2.js) is
// gone, plus chuck, nasa, close, gpt, deepseek2, removebg, gemini, grok
// (dead endpoints), the five old tts commands, vv/vv2 (Ggs + 🔓 cover them).
// Kept: recording (one-shot) alongside autorec/autotype, open, .menu/.help
// now deliver the original v1.4.44 boxed megamenu with our own image.

test("every command is registered without collisions and the pruned set is exact", async () => {
  const { commands, lookup } = await loadCommands(path.resolve("commands"));
  const count = category => commands.filter(command => command.category === category).length;

  assert.equal(commands.length, 183);
  assert.equal(count("AI & Chat"), 10);
  assert.equal(count("AI Media"), 8);
  assert.equal(count("General"), 15);
  assert.equal(count("Owner"), 2);
  assert.equal(count("Canvas"), 2);
  assert.equal(count("Channel"), 8);
  assert.equal(count("Fun"), 20);
  assert.equal(count("Games"), 12);
  assert.equal(count("Group"), 29);
  assert.equal(count("Privacy"), 20);
  assert.equal(count("Media & Tools"), 5); // + vv/vv2 test extractors
  assert.equal(count("Downloads"), 10);
  assert.equal(count("Status"), 18);
  assert.equal(count("News"), 15);
  assert.equal(count("Chat & Privacy"), 1);
  assert.equal(count("Tools"), 8);
  for (const category of ["Anime GIFs", "Anime Images", "Anime Info", "Anime Random", "Anime Rankings", "Anime Tools"]) {
    assert.equal(count(category), 0, "anime commands must be gone: " + category);
  }

  // The kept set answers.
  for (const name of [
    "menu", "sections", "help", "commands", "cmds", "ping", "alive", "owner", "support", "time", "date", "version", "jid", "whoami",
    "ai", "claude", "fable", "fable5", "chatgpt", "mathgpt", "deepseek", "translate", "summarize", "aidetect",
    "flux", "pollination", "ttsm", "ttsf", "sora", "voices", "vn2text", "ssweb",
    "typing", "recording", "autotype", "autorec", "online", "pres", "vv", "vv2", "ggs", "gg", "vvinfo",
    "ggs", "vvinfo", "sticker", "save", "tiktokstalk", "bible", "couplepp", "pp", "shortenurl",
    "song", "play2", "ytsearch", "yt", "video", "aio", "fb", "twitter", "instagram", "insta", "tiktok", "tiktok2",
    "welcome", "goodbye", "groupinfo", "admins", "tagall", "link", "groupname", "groupdesc", "open", "revoke", "kick", "promote", "demote", "antilink", "warn", "warnlist", "tldr", "lore", "roast", "del",
    "calc", "poll", "coinflip", "dice", "8ball", "choose", "trivia", "riddle", "activity", "rate", "love", "wcg", "pokemon",
    "joke", "dadjoke", "progjoke", "fact2", "catfact", "dog", "cat", "fox", "advice", "quote", "quote2", "quoted", "randomjoke", "echo", "react", "meme", "numfact", "history", "wiki",
    "privacy", "statusdraft", "statusideas", "runtime", "prefix", "canvasquote", "lyrics",
    "cfollow", "cunfollow", "channels", "cstatus", "cpost", "creact", "cvote", "msessions"
  ]) {
    assert.ok(lookup.has(name), "missing command or alias " + name);
  }

  // The pruned set must not answer.
  for (const name of [
    "anime", "animechars", "animemenu", "baka", "bleh", "blowkiss", "blush", "bored", "clap", "cry", "dance",
    "facepalm", "genre", "genres", "handhold", "handshake", "happy", "highfive", "hug", "husbando", "kabedon",
    "kiss", "kitsune", "lappillow", "laugh", "lurk", "neko", "nod", "nom", "nope", "nya", "pat", "peck",
    "pictures", "poke", "pout", "randomanime", "randommanga", "recommend", "run", "shake", "shrug", "sip",
    "sleep", "smile", "smug", "spin", "staff", "stare", "streaming", "tickle", "think", "teehee", "topanime",
    "topmanga", "trailer", "wag", "waifu2", "wave", "whatanime", "wink", "yawn", "yeet",
    "chuck", "nasa", "close", "gpt", "deepseek2", "removebg", "qwen",
    "tts", "tts2", "tts3", "tts4", "tts5"
  ]) {
    assert.equal(lookup.has(name), false, "removed command still registered: " + name);
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

test("menu-plan covers every remaining category with nothing hidden", async () => {
  const { commands } = await loadCommands(path.resolve("commands"));
  const hiddenCount = applyMenuPlan(commands);
  assert.equal(hiddenCount, 0, "no command may be left uncovered by the sections");
  assert.equal(commands.filter(command => command.hidden).length, 0);
});

test("the bot ships its own image (not FEI's) and the payload loads", () => {
  assert.equal(config.name, "DamzD");
  assert.equal(config.ownerName, "DamzD");
  assert.ok(String(config.botImage).includes("bot-image"), "bot image points at our own asset");
  const payload = botImagePayload(config);
  assert.ok(payload && payload.image && payload.image.length > 50000, "our bundled bot image loads as a buffer");
});

test("menu delivers one captioned image message; help delivers one full boxed list", async () => {
  const { commands } = await loadCommands(path.resolve("commands"));
  const menuCommand = commands.find(command => command.name === "menu");
  const helpCommand = commands.find(command => command.name === "help");
  const sent = [];
  const ctx = {
    config,
    commands,
    args: "",
    send: async payload => sent.push({ type: "media", payload }),
    reply: async payload => sent.push({ type: "text", payload })
  };

  await menuCommand.run(ctx);
  assert.equal(sent.length, 1, "menu must be ONE message");
  assert.equal(sent[0].type, "media", "menu ships our own picture");
  assert.ok(sent[0].payload.caption.includes("\u2302") && sent[0].payload.caption.includes("menu <section>"), "menu shows the section overview");
  assert.ok(sent[0].payload.caption.includes("𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗚𝗥𝗘𝗔𝗧 𝗗𝗔𝗠𝗭𝗗"));
  assert.ok(!String(config.botImage).includes("cloudinary"), "the FEI cloudinary image is gone");

  sent.length = 0;
  await helpCommand.run(ctx);
  assert.equal(sent.length, 1, "help must be ONE message, not chunks");
  const text = sent[0].payload.caption || sent[0].payload;
  assert.ok(text.includes(".song") && text.includes(".ggs") && text.includes(".ttsm"), "help lists every section boxed");
  assert.ok(text.includes(".song"), "help shows the song command");
  assert.ok(text.includes(".ttsm"), "help shows the new tts commands");
  assert.ok(text.includes(".vv"), "help advertises the vv test extractor");
});

test(".help <command> opens a detail card, .menu <section> opens that section", async () => {
  const { commands } = await loadCommands(path.resolve("commands"));
  const helpCommand = commands.find(command => command.name === "help");
  const menuCommand = commands.find(command => command.name === "menu");
  const text = payload => typeof payload === "string" ? payload : String(payload?.caption || "");
  const out = [];
  const base = {
    config, commands,
    send: async payload => out.push(text(payload)),
    reply: async payload => out.push(text(payload))
  };

  await helpCommand.run({ ...base, args: "song" });
  assert.ok(out.find(v => v.includes("Send any song as full audio")), "help <command> shows a detail card");

  await menuCommand.run({ ...base, args: "downloads" });
});
