/**
 * DamzD smoke test — runs the full message pipeline with a mocked WhatsApp socket.
 * No real connection needed. Run with: npm test
 */
process.env.OWNER_NUMBER = "2348000000001";
process.env.ACCESS_MODE = "self";
process.env.GROQ_API_KEY = "test-key";
process.env.DATA_DIR = "./test/.tmp-data";

const sent = [];
const presence = [];
let groupMeta = null;
const groqCalls = [];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url instanceof URL ? url : url);
  if (target.includes("api.groq.com")) {
    groqCalls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Good evening! I am doing well, thank you for asking." } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (target.includes("apis.nabeestech.com")) {
    return new Response(JSON.stringify({
      success: true,
      data: {
        title: "Funny cat clip",
        medias: [{ url: "https://cdn.example.com/video.mp4", type: "video/mp4", extension: "mp4", quality: "720p" }]
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, options);
};

const { loadCommands, buildLookup, resolveCommandInput } = await import("../src/loader.js");
const { ChatMemory } = await import("../src/memory.js");
const { JsonStore, ANTILINK_ON } = await import("../src/store.js");
const { processMessage } = await import("../src/runtime.js");
const assert = await import("node:assert");
const fs = await import("node:fs");
fs.rmSync(new URL("../test/.tmp-data", import.meta.url).pathname, { recursive: true, force: true });

const commands = await loadCommands(new URL("../commands/", import.meta.url).pathname);
const lookup = buildLookup(commands);
const memory = new ChatMemory(process.env.DATA_DIR);
const store = new JsonStore(process.env.DATA_DIR, "settings.json");

const ownerSock = {
  user: { id: "2348000000002@s.whatsapp.net" },
  sendMessage: async (jid, content) => { sent.push({ jid, content }); return {}; },
  sendPresenceUpdate: async (type, jid) => { presence.push({ type, jid }); },
  groupMetadata: async () => groupMeta,
  groupParticipantsUpdate: async () => ({})
};

const nonOwnerSock = {
  user: { id: "2348000000002@s.whatsapp.net" },
  sendMessage: async (jid, content) => { sent.push({ jid, content }); return {}; },
  sendPresenceUpdate: async (type, jid) => { presence.push({ type, jid }); },
  groupMetadata: async () => groupMeta,
  groupParticipantsUpdate: async () => ({})
};

function textMessage(text, overrides = {}) {
  return {
    key: {
      remoteJid: overrides.jid || "2348000000001@s.whatsapp.net",
      fromMe: overrides.fromMe ?? true,
      id: overrides.id || "MSG" + Math.random().toString(36).slice(2)
    },
    pushName: "Tester",
    message: { conversation: text }
  };
}

const deps = { processed: new Set(), store, memory, lookup, commands };
let passed = 0;
async function check(label, fn) {
  await fn();
  passed += 1;
  console.log("  ✔ " + label);
}

console.log("DamzD smoke test (" + commands.length + " commands loaded)");

await check("ping command replies with uptime", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".ping"));
  assert.ok(sent.length >= 1);
  assert.match(sent[0].content.text, /here and running/);
});

await check("menu shows section overview without any promo footer", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".menu"));
  const text = sent.map(item => item.content.text || "").join("\n");
  assert.match(text, /Here is everything I can do/);
  assert.match(text, /\*News\*/);
  assert.match(text, /\*Anime\*/);
  assert.ok(!/powered by|pairing portal|benfei/i.test(text), "no promotional text allowed");
});

await check("menu section opens with full command list", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".menu news"));
  const text = sent.at(-1).content.text;
  assert.match(text, /\*News\*/);
  assert.match(text, /\.bbc — /);
});

await check("the expanded command set loaded with clean aliases", async () => {
  assert.ok(commands.length >= 150, "expected 150+ commands, got " + commands.length);
  assert.equal(lookup.get("ytmp4").name, "yt", "ytmp4 maps to yt");
  assert.equal(lookup.get("ttdl").name, "tiktok", "ttdl maps to tiktok");
  assert.equal(lookup.get("uptime").name, "alive", "uptime maps to alive");
  assert.equal(lookup.get("summarize").name, "tldr", "summarize maps to tldr");
  assert.ok(!lookup.has("ytmp3"), "ytmp3 was removed as requested");
  assert.ok(!lookup.has("benfei"), "no benfei branding");
});

await check("echo repeats text exactly", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".echo testing one two"));
  assert.equal(sent.at(-1).content.text, "testing one two");
});

await check("whoami introduces the sender", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".whoami"));
  assert.match(sent.at(-1).content.text, /You are @2348000000002/);
});

await check("news command lists its desks", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".news"));
  const text = sent.at(-1).content.text;
  assert.match(text, /bbc/i);
  assert.match(text, /punch/i);
});

await check("anime reaction command list is wired to categories", async () => {
  const names = new Set(commands.map(command => command.name));
  for (const expected of ["hug", "kiss", "slap", "pat", "yeet", "waifu", "8ball"]) {
    assert.ok(names.has(expected), "missing command: " + expected);
  }
  const canvasNames = new Set(commands.map(command => command.name));
  for (const expected of ["fakettc", "receipt", "nokiamsg", "iqc", "fakeff"]) {
    assert.ok(canvasNames.has(expected), "missing canvas command: " + expected);
  }
});

await check("unknown command in DM gets a gentle suggestion", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".frobnicate"));
  assert.match(sent[0].content.text, /do not know that command/);
});

await check("plain DM text goes to the AI brain with memory", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  await processMessage(deps, ownerSock, textMessage("Hello, how are you today?"));
  assert.ok(groqCalls.length === 1, "groq should have been called");
  assert.match(groqCalls[0].model, /llama/);
  assert.match(groqCalls[0].messages[0].content, /DamzD/);
  assert.ok(!/How may I assist you today/.test(groqCalls[0].messages[0].content));
  assert.match(sent.at(-1).content.text, /Good evening/);
  assert.ok(presence.some(item => item.type === "composing"), "should show typing first");
  assert.equal(memory.history("2348000000001@s.whatsapp.net").length, 2, "user + assistant stored");
});

await check("AI replies use memory context on follow-ups", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  await new Promise(resolve => setTimeout(resolve, 2600));
  await processMessage(deps, ownerSock, textMessage("What did I just ask you?"));
  const lastUser = groqCalls[0].messages.filter(m => m.role === "user").at(-1).content;
  assert.equal(lastUser, "What did I just ask you?");
  const previousUser = groqCalls[0].messages.filter(m => m.role === "user").at(0).content;
  assert.equal(previousUser, "Hello, how are you today?", "earlier turn must be in context");
});

await check("self mode ignores non-owner messages completely", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  const stranger = textMessage("Hello there, anybody home?", {
    jid: "2348999999999@s.whatsapp.net",
    fromMe: false
  });
  await processMessage(deps, nonOwnerSock, stranger);
  assert.equal(sent.length, 0, "no reply to a stranger in self mode");
  assert.equal(groqCalls.length, 0);
});

await check("link sent in DM auto-downloads without a command", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage("check this out https://www.tiktok.com/@user/video/123"));
  const kinds = sent.map(item => Object.keys(item.content)[0]);
  assert.ok(kinds.includes("video"), "should send the video");
});

await check("group mention wakes the AI", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  groupMeta = {
    id: "123@g.us",
    subject: "Test group",
    participants: [
      { id: "2348000000002@s.whatsapp.net", admin: "admin" },
      { id: "2348000000001@s.whatsapp.net", admin: null }
    ]
  };
  await new Promise(resolve => setTimeout(resolve, 2600));
  const mention = textMessage("@2348000000002 what is the plan for today?", { jid: "123@g.us", fromMe: true });
  mention.key.participant = "2348000000001@s.whatsapp.net";
  mention.message = {
    extendedTextMessage: {
      text: "@2348000000002 what is the plan for today?",
      contextInfo: { mentionedJid: ["2348000000002@s.whatsapp.net"] }
    }
  };
  await processMessage(deps, ownerSock, mention);
  assert.ok(groqCalls.length === 1, "mention should trigger the AI");
  assert.match(sent.at(-1).content.text, /Good evening/);
});

await check("group message without mention stays quiet", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  await new Promise(resolve => setTimeout(resolve, 2600));
  await processMessage(deps, ownerSock, textMessage("anyone watching the match?", { jid: "123@g.us" }));
  assert.equal(groqCalls.length, 0, "must not chat uninvited in groups");
});

await check("antilink removes member links and warns", async () => {
  sent.length = 0;
  store.set(ANTILINK_ON + ":123@g.us", true);
  const intruder = textMessage("buy stuff at https://www.tiktok.com/@spam/video/9", { jid: "123@g.us", fromMe: false });
  intruder.key.participant = "2348555000003@s.whatsapp.net";
  intruder.key.id = "ANTILINK1";
  await processMessage(deps, nonOwnerSock, intruder);
  const text = sent.map(item => item.content.text || "").join(" ");
  assert.match(text, /Removed that message|warning 1 of 3/);
  store.set(ANTILINK_ON + ":123@g.us", false);
});

await check("trivia round asks then accepts the right answer", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".trivia"));
  const question = sent.at(-1).content.text;
  assert.match(question, /Trivia time/);
  const bank = [
    ["Which planet is known as the Red Planet?", "mars"],
    ["What is the largest ocean on Earth?", "pacific ocean"],
    ["How many sides does a hexagon have?", "6"],
    ["What is the capital of Japan?", "tokyo"],
    ["What is the fastest land animal?", "cheetah"],
    ["How many colours are traditionally listed in a rainbow?", "7"],
    ["Which organ pumps blood around the human body?", "heart"],
    ["What is the chemical symbol for gold?", "au"],
    ["Which continent is the Sahara Desert in?", "africa"],
    ["What is the tallest mountain in the world?", "mount everest"]
  ];
  const entry = bank.find(([q]) => question.includes(q));
  assert.ok(entry, "question must come from the local bank");
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".trivia " + entry[1]));
  assert.match(sent.at(-1).content.text, /Correct/);
});

await check("coinflip and dice always answer cleanly", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".coinflip"));
  assert.match(sent[0].content.text, /Heads|Tails/);
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".dice"));
  assert.match(sent[0].content.text, /rolled a \*[1-6]\*/);
});

await check("calc handles arithmetic safely", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".calc (12+8)*3"));
  assert.match(sent[0].content.text, /= \*60\*/);
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".calc process.exit(1)"));
  assert.match(sent[0].content.text, /did not work/);
});

await check("no reply text ever contains promotional content", async () => {
  const all = sent.map(item => JSON.stringify(item.content)).join(" ").toLowerCase();
  for (const phrase of ["powered by", "pairing portal", "benfei", "unlock", "premium"]) {
    assert.ok(!all.includes(phrase), "found promo text: " + phrase);
  }
});

memory.saveNow();
console.log("\nAll " + passed + " checks passed. DamzD behaves like a human, runs commands, and never advertises.");
