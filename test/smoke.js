/**
 * DamzD smoke test — runs the full message pipeline with a mocked WhatsApp socket.
 * No real connection needed. Run with: npm test
 */
process.env.OWNER_NUMBER = "2348000000001";
process.env.ACCESS_MODE = "self";
process.env.GROQ_API_KEY = "test-key";
// The suite runs as a child bot: children run on Groq (the split from
// v1.4.19), and the Groq mock below stands in for that brain. The main bot's
// Puter/Groq split is asserted separately in its own check.
process.env.DAMZD_CHILD = "1";
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
const { setAccessMode } = await import("../src/config.js");
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

const deps = { processed: new Set(), ownerActivity: new Map(), store, memory, lookup, commands };
const firstText = () => sent.map(item => item.content?.text || "").find(Boolean) || "";
let passed = 0;
async function check(label, fn) {
  await fn();
  passed += 1;
  console.log("  ✔ " + label);
}

console.log("DamzD smoke test (" + commands.length + " commands loaded)");

await check("ping command reacts ⚡ then replies with uptime", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".ping"));
  assert.ok(sent.some(item => item.content?.react?.text === "⚡"), "command should get a ⚡ reaction");
  const reply = sent.map(item => item.content.text || "").find(Boolean) || "";
  assert.match(reply, /here and running/);
});

await check("menu shows section overview without any promo footer", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".menu"));
  const text = sent.map(item => item.content.text || "").join("\n");
  assert.match(text, /Here is everything I can do/);
  assert.match(text, /\*News\*/);
  assert.match(text, /\*Fun\*/);
  assert.ok(!/\*Anime\*/.test(text), "the anime section is gone as requested");
  assert.ok(!/\*Canvas\*/.test(text), "the fake-generator canvas section is gone as requested");
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

await check("honest fun commands stay wired after the anime and fake-generator removals", async () => {
  const names = new Set(commands.map(command => command.name));
  for (const expected of ["8ball", "coinflip", "dog", "cat"]) {
    assert.ok(names.has(expected), "missing command: " + expected);
  }
  for (const removed of ["fakettc", "fakechat", "receipt", "nokiamsg", "meme", "meme2", "fakeff", "fakeffduo", "ffgirl", "canvasquote", "iqc", "wndwqute"]) {
    assert.ok(!names.has(removed), "fake-generator command still present: " + removed);
  }
});

await check(".Ggs is the harmless gaming skin", async () => {
  assert.equal(lookup.get("ggs")?.name, "Ggs", "ggs command exists");
  assert.ok(!lookup.has("vv"), "vv is fully gone");
  assert.ok(!lookup.has("viewonce"), "viewonce alias is gone too");
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".Ggs"));
  assert.match(firstText(), /GG|good game/i);
});

await check(".Ggs, .ggs and .gg all reach the recovery command (case-insensitive)", async () => {
  for (const typed of [".Ggs", ".ggs", ".gg", ".GGS", ".GG"]) {
    const parsed = resolveCommandInput(typed, ".");
    // the exact spelling lowercases into "ggs" or the "gg" alias — both keys
    // must land on the same Ggs command
    assert.ok(["ggs", "gg"].includes(parsed.name), typed + " parses to a known key");
    assert.equal(lookup.get(parsed.name)?.name, "Ggs", typed + " routes to the Ggs command");
  }
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".ggs"));
  assert.match(firstText(), /GG|good game/i);
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".gg"));
  assert.match(firstText(), /GG|good game/i);
});

await check("unknown command gets a gentle suggestion only in the bot's own chat", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".frobnicate", { jid: ownerSock.user.id }));
  assert.match(firstText(), /do not know that command/);
  // In a friend's chat even a typo'd command stays invisible — a "..." typed
  // to a friend must never make her talk.
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".frobnicate", { jid: "2348000000009@s.whatsapp.net" }));
  assert.equal(sent.length, 0, "unknown commands are silent in other people's chats");
});

await check("the owner's text to a friend is NEVER answered (the amebo fix)", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  const friendChat = "2348000000009@s.whatsapp.net";
  await processMessage(deps, ownerSock, textMessage("Hello, how are you today?", { jid: friendChat }));
  await processMessage(deps, ownerSock, textMessage("I will call you later", { jid: friendChat, id: "FRIEND2" }));
  assert.equal(sent.length, 0, "his own conversations must stay untouched");
  assert.equal(groqCalls.length, 0, "no AI calls for his outgoing texts");
});

await check("the owner's chat with the bot itself still gets the full assistant", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  const selfChat = ownerSock.user.id;
  await processMessage(deps, ownerSock, textMessage("Hello, how are you today?", { jid: selfChat }));
  assert.ok(groqCalls.length === 1, "groq should have been called");
  assert.match(groqCalls[0].model, /llama/);
  assert.match(groqCalls[0].messages[0].content, /DamzD/);
  assert.ok(!/How may I assist you today/.test(groqCalls[0].messages[0].content));
  assert.match(sent.at(-1).content.text, /Good evening/);
  assert.ok(presence.some(item => item.type === "composing"), "should show typing first");
  assert.equal(memory.history(selfChat).length, 2, "user + assistant stored");
});

await check("AI replies use memory context on follow-ups", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  await new Promise(resolve => setTimeout(resolve, 2600));
  const selfChat = ownerSock.user.id;
  await processMessage(deps, ownerSock, textMessage("What did I just ask you?", { jid: selfChat }));
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

await check("public mode receptionist greets greetings with a short line", async () => {
  setAccessMode("public");
  sent.length = 0;
  groqCalls.length = 0;
  const fan = "2348666000005@s.whatsapp.net";
  await processMessage(deps, nonOwnerSock, textMessage("Good morning", { jid: fan, fromMe: false }));
  const reply = sent.map(item => item.content?.text || "").find(Boolean) || "";
  assert.match(reply, /DamzD will attend|will reply you|will get back to you|will reach you when he is less busy/);
  assert.equal(groqCalls.length, 0, "greetings never wake the AI brain");
});

await check("public mode receptionist answers questions with 'will attend once free'", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  await new Promise(resolve => setTimeout(resolve, 2600));
  const fan2 = "2348666000006@s.whatsapp.net";
  await processMessage(deps, nonOwnerSock, textMessage("What is the plan for today?", { jid: fan2, fromMe: false }));
  const reply = sent.map(item => item.content?.text || "").find(Boolean) || "";
  assert.match(reply, /once he is free|as soon as he is free/);
  assert.equal(groqCalls.length, 0, "questions get the receptionist, not the AI");
});

await check("public mode receptionist stays silent for ordinary chatter", async () => {
  sent.length = 0;
  await new Promise(resolve => setTimeout(resolve, 2600));
  const fan3 = "2348666000007@s.whatsapp.net";
  await processMessage(deps, nonOwnerSock, textMessage("lol ok na", { jid: fan3, fromMe: false }));
  assert.equal(sent.length, 0, "no amebo — no reply to ordinary chatter");
});

await check("receptionist goes quiet while the owner is present in that chat", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  const friendChat = "2348000000009@s.whatsapp.net";
  // The owner is right there texting his friend…
  await processMessage(deps, ownerSock, textMessage("I dey come", { jid: friendChat, id: "ACTIVE1" }));
  // …so even a greeting from the friend gets no receptionist reply.
  await new Promise(resolve => setTimeout(resolve, 2600));
  await processMessage(deps, nonOwnerSock, textMessage("hello o", { jid: friendChat, fromMe: false }));
  assert.equal(sent.length, 0, "owner is present — she says nothing");
});

await check("link sent in DM auto-downloads without a command", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage("check this out https://www.tiktok.com/@user/video/123"));
  const kinds = sent.map(item => Object.keys(item.content)[0]);
  assert.ok(kinds.includes("video"), "should send the video");
});

await check("group mention wakes the AI for the owner", async () => {
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

await check("owner's plain group message no longer wakes the AI", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  await new Promise(resolve => setTimeout(resolve, 2600));
  await processMessage(deps, ownerSock, textMessage("anyone watching the match?", { jid: "123@g.us" }));
  assert.equal(groqCalls.length, 0, "his group chat is conversation, not a prompt");
  assert.equal(sent.length, 0, "and she does not talk over him");
});

await check("non-owner group mention gets the receptionist in public mode", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  // The owner left the group more than 10 minutes ago — simulate that here,
  // because earlier checks in this file had him texting in the same group.
  deps.ownerActivity.delete("123@g.us");
  await new Promise(resolve => setTimeout(resolve, 2600));
  const ping = textMessage("@2348000000002 who is this?", { jid: "123@g.us", fromMe: false });
  ping.key.participant = "2348555000009@s.whatsapp.net";
  ping.message = {
    extendedTextMessage: {
      text: "@2348000000002 who is this?",
      contextInfo: { mentionedJid: ["2348000000002@s.whatsapp.net"] }
    }
  };
  await processMessage(deps, nonOwnerSock, ping);
  const reply = sent.map(item => item.content?.text || "").find(Boolean) || "";
  assert.match(reply, /he is free/);
  assert.equal(groqCalls.length, 0);
  setAccessMode("self");
});

await check("non-owner group message without mention stays quiet", async () => {
  sent.length = 0;
  groqCalls.length = 0;
  const bystander = textMessage("anyone watching the match?", { jid: "123@g.us", fromMe: false });
  bystander.key.participant = "2348555000009@s.whatsapp.net";
  await processMessage(deps, nonOwnerSock, bystander);
  assert.equal(groqCalls.length, 0, "only mentions can wake her in groups");
  assert.equal(sent.length, 0);
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
  assert.match(firstText(), /Heads|Tails/);
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".dice"));
  assert.match(firstText(), /rolled a \*[1-6]\*/);
});

await check("calc handles arithmetic safely", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".calc (12+8)*3"));
  assert.match(firstText(), /= \*60\*/);
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".calc process.exit(1)"));
  assert.match(firstText(), /did not work/);
});

await check("the AI auto-router sends each task to the right flagship", async () => {
  const { classifyTask, routeTask } = await import("../src/ai.js");
  assert.equal(classifyTask("write a function to reverse a linked list in javascript"), "code");
  assert.equal(routeTask("fix this bug in my python script")[0], "gpt-6-astra", "code goes to Astra");
  assert.equal(classifyTask("solve 12 * 9 + 45 step by step"), "math");
  assert.equal(routeTask("what is the integral of x^2")[0], "gpt-6.1-sol", "maths goes to Sol");
  assert.equal(classifyTask("tell me a bedtime story about a lion"), "creative");
  assert.equal(routeTask("write a poem for my mum")[0], "claude-fable-5-2", "creative writing goes to Fable");
  assert.equal(classifyTask("translate good morning to yoruba"), "translate");
  assert.equal(routeTask("how do you say thank you in french")[0], "gpt-6-luna", "translation goes to fast Luna");
  assert.equal(routeTask("who is the president of france")[0], "gpt-6.1-sol", "general chat goes to Sol");
  assert.equal(lookup.get("chatgpt")?.brains?.[0], "auto", ".chatgpt uses the auto router");
  for (const name of ["astra", "sol", "terra", "fable"]) {
    assert.ok(lookup.has(name), "missing flagship command: " + name);
  }
  assert.equal(lookup.get("astra")?.brains?.[0], "puter-model:gpt-6-astra", ".astra hits the real model");
  assert.equal(lookup.get("claude")?.brains?.[0], "puter-model:claude-opus-5-5", ".claude hits Opus 5.5");
  assert.equal(lookup.get("gemini")?.brains?.[0], "puter-model:gemini-4-argon", ".gemini hits Gemini 4 Argon");
});

await check("session ban — a banned friend's bot stops and unban revives it", async () => {
  const path = await import("node:path");
  const os = await import("node:os");
  const { SessionManager } = await import("../src/sessions.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "damzd-ban-"));
  const dummy = path.join(tmp, "dummy.js"); // a child that just sleeps — no real bot boots in tests
  fs.writeFileSync(dummy, "setTimeout(function(){}, 6e10);");
  const mgr = new SessionManager({ dataDirectory: tmp, entryPath: dummy });
  assert.equal(mgr.maxSessions, 5, "default cap is now 5 slots");
  await mgr.connect("08010000001"); // local format — normalized against the owner's country code
  assert.ok(mgr.children.has("2348010000001"), "friend session spawned");
  const banned = mgr.ban("2348010000001");
  assert.ok(banned.ok, "ban succeeds");
  assert.equal(mgr.children.has("2348010000001"), false, "their bot is stopped on ban");
  assert.equal(mgr.readStatuses().find(row => row.number === "2348010000001").banned, true, "dashboard sees the ban");
  assert.equal(mgr.ban("2348010000001").ok, false, "double ban is rejected");
  mgr.spawn("2348010000001");
  assert.equal(mgr.children.has("2348010000001"), false, "a banned number never respawns");
  assert.ok(mgr.unban("2348010000001").ok, "unban succeeds");
  assert.ok(mgr.children.has("2348010000001"), "their bot comes back after unban");
  assert.equal(mgr.unban("2348010000001").ok, false, "unban of a non-banned number is rejected");
  assert.equal(mgr.ban("2348099999999").ok, false, "ban of an unconnected number is rejected");
  mgr.stopAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

await check(".ban from chat stops a connected friend's bot and .unban revives it", async () => {
  const path = await import("node:path");
  const os = await import("node:os");
  const { SessionManager } = await import("../src/sessions.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "damzd-ban-cmd-"));
  const dummy = path.join(tmp, "dummy.js");
  fs.writeFileSync(dummy, "setTimeout(function(){}, 6e10);");
  const mgr = new SessionManager({ dataDirectory: tmp, entryPath: dummy });
  await mgr.connect("08010000003");
  deps.sessions = mgr; // the main bot carries the session manager for owner commands
  try {
    sent.length = 0;
    // local number format typed by the owner — has() must normalize it
    await processMessage(deps, ownerSock, textMessage(".ban 08010000003"));
    assert.match(firstText(), /banned — their connected bot is stopped/);
    assert.equal(mgr.children.has("2348010000003"), false, "their bot process is dead");
    assert.equal(mgr.readStatuses().find(row => row.number === "2348010000003").banned, true, "registry shows the ban");
    // while banned, .ban again reports the friendly error, not a crash
    sent.length = 0;
    await processMessage(deps, ownerSock, textMessage(".ban 08010000003"));
    assert.match(firstText(), /already banned/);
    // unbanning from chat brings the bot back
    sent.length = 0;
    await processMessage(deps, ownerSock, textMessage(".unban 08010000003"));
    assert.match(firstText(), /unbanned — their bot is starting again/);
    assert.ok(mgr.children.has("2348010000003"), "their bot respawned");
    // a number that never connected falls through to the per-chat user ban
    sent.length = 0;
    await processMessage(deps, ownerSock, textMessage(".ban 2348111122222"));
    assert.match(firstText(), /banned from using me/);
    sent.length = 0;
    await processMessage(deps, ownerSock, textMessage(".unban 2348111122222"));
    assert.match(firstText(), /can use me again/);
  } finally {
    delete deps.sessions;
    mgr.stopAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

await check("the AI split — main bot never sees Groq, children run on Groq only", async () => {
  const saved = process.env.DAMZD_CHILD;
  // Main bot mode (fresh module instance via the query-string cache buster):
  // Groq key is stripped no matter what the environment says, Puter accounts
  // arrive deduped, and the bot counts as having a brain through Puter.
  process.env.DAMZD_CHILD = "";
  process.env.PUTER_AUTH_TOKEN = "tok-a, tok-b ,tok-a";
  const mainMod = await import("../src/config.js?main");
  assert.equal(mainMod.childMode, false);
  assert.equal(mainMod.config.groq.apiKey, "", "main bot must never carry a Groq key");
  assert.deepEqual(mainMod.config.puterTokens, ["tok-a", "tok-b"], "Puter accounts deduped");
  assert.equal(mainMod.hasAIBrain(), true, "main bot has a brain via Puter");
  // Child mode: Groq is the brain, Puter is empty — friends never burn the
  // owner's Puter quota.
  process.env.DAMZD_CHILD = "1";
  const childMod = await import("../src/config.js?child");
  assert.equal(childMod.childMode, true);
  assert.equal(childMod.config.groq.apiKey, "test-key", "children run on Groq");
  assert.equal(childMod.config.puterTokens.length, 0, "children never touch Puter");
  assert.equal(childMod.hasAIBrain(), true, "child bot has a brain via Groq");
  process.env.DAMZD_CHILD = saved;
  delete process.env.PUTER_AUTH_TOKEN;
});

await check(".voices lists the AI voices .tts can speak with", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".voices"));
  const reply = firstText();
  assert.match(reply, /tts ezinne/i);
  assert.match(reply, /abeo/i);
  assert.match(reply, /Nigerian/);
  assert.match(reply, /British/);
});

await check("no reply text ever contains promotional content", async () => {
  const all = sent.map(item => JSON.stringify(item.content)).join(" ").toLowerCase();
  for (const phrase of ["powered by", "pairing portal", "benfei", "unlock", "premium"]) {
    assert.ok(!all.includes(phrase), "found promo text: " + phrase);
  }
});

memory.saveNow();
console.log("\nAll " + passed + " checks passed. DamzD behaves like a human, runs commands, and never advertises.");
