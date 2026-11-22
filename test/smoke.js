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

const resendRequests = [];
const ownerSock = {
  user: { id: "2348000000002@s.whatsapp.net" },
  sendMessage: async (jid, content) => { sent.push({ jid, content }); return {}; },
  sendPresenceUpdate: async (type, jid) => { presence.push({ type, jid }); },
  groupMetadata: async () => groupMeta,
  groupParticipantsUpdate: async () => ({}),
  requestPlaceholderResend: async key => { resendRequests.push(key); return "REQ-" + resendRequests.length; }
};

const nonOwnerSock = {
  user: { id: "2348000000002@s.whatsapp.net" },
  sendMessage: async (jid, content) => { sent.push({ jid, content }); return {}; },
  sendPresenceUpdate: async (type, jid) => { presence.push({ type, jid }); },
  groupMetadata: async () => groupMeta,
  groupParticipantsUpdate: async () => ({}),
  requestPlaceholderResend: async key => { resendRequests.push(key); return "REQ-" + resendRequests.length; }
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

await check("ping draws the boxed status card in the megamenu style", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".ping"));
  assert.ok(sent.some(item => item.content?.react?.text === "⚡"), "command should get a ⚡ reaction");
  const reply = sent.map(item => item.content.text || "").find(Boolean) || "";
  assert.match(reply, /╭──〔 ⚡ 𝗣𝗜𝗡𝗚 〕/);
  assert.match(reply, /alive and answering/);
  assert.match(reply, /𝗨𝗣𝗧𝗜𝗠𝗘: /);
  assert.match(reply, /✦ 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗚𝗥𝗘𝗔𝗧 𝗗𝗔𝗠𝗭𝗗/);
});

await check("menu shows the boxed section overview with the Great DamzD ending", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".menu"));
  const text = sent.map(item => item.content.text || item.content.caption || "").join("\n");
  assert.match(text, /╭──〔 DamzD 〕/, "the header box carries the bot name");
  assert.match(text, /𝗢𝗪𝗡𝗘𝗥/, "the owner row the big menus carry");
  assert.match(text, /𝗠𝗢𝗗𝗘/, "the access-mode row");
  assert.match(text, /𝗨𝗣𝗧𝗜𝗠𝗘/, "the uptime row");
  assert.match(text, /𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 𝗟𝗢𝗔𝗗𝗘𝗗: \d+/, "live loaded-command count");
  assert.ok(!/𝗣𝗥𝗘𝗙𝗜𝗫/.test(text), "no prefix row in the header — removed as requested");
  assert.match(text, /𝗡𝗘𝗪𝗦/, "News section listed");
  assert.match(text, /𝗙𝗨𝗡/, "Fun section listed");
  assert.ok(!/𝗔𝗡𝗜𝗠𝗘/.test(text), "the anime section is gone as requested");
  assert.ok(!/𝗖𝗔𝗡𝗩𝗔𝗦/.test(text), "the fake-generator canvas section is gone as requested");
  assert.ok(!/benfei|pairing portal/i.test(text), "no third-party promotional text allowed");
  assert.match(text, /✦ 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗚𝗥𝗘𝗔𝗧 𝗗𝗔𝗠𝗭𝗗/, "the ending the owner asked for");
});

await check("menu section opens with full command list", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".menu news"));
  const text = sent.at(-1).content.text || sent.at(-1).content.caption;
  assert.match(text, /╭──〔 📰 𝗡𝗘𝗪𝗦 〕/);
  assert.match(text, /\.bbc — /);
  assert.match(text, /✦ 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗚𝗥𝗘𝗔𝗧 𝗗𝗔𝗠𝗭𝗗/);
});

await check(".help draws the full boxed megamenu like the classic bots", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".help"));
  // long replies may be chunked — read every piece, caption or text
  const text = sent.map(item => item.content?.text || item.content?.caption || "").join("\n");
  assert.match(text, /╭──〔 DamzD 〕/);
  assert.match(text, /╭──〔 🤖 𝗚𝗘𝗡𝗘𝗥𝗔𝗟 〕/);
  assert.match(text, /╰────────────────/);
  assert.match(text, /\.voices — /, "the new voices command is listed");
  assert.match(text, /\.tts — /);
  assert.ok(!/𝗔𝗡𝗜𝗠𝗘/.test(text), "no anime section in the megamenu");
  assert.match(text, /✦ 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗚𝗥𝗘𝗔𝗧 𝗗𝗔𝗠𝗭𝗗/, "ends with the brand line");
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

await check(".accessmode public opens the AI to group members, private closes it", async () => {
  setAccessMode("public");
  deps.store.set("accessmode", "public");
  sent.length = 0;
  groqCalls.length = 0;
  deps.ownerActivity.delete("123@g.us");
  await new Promise(resolve => setTimeout(resolve, 2600));
  const ask = textMessage("@2348000000002 who is this?", { jid: "123@g.us", fromMe: false });
  ask.key.participant = "2348555000009@s.whatsapp.net";
  ask.message = {
    extendedTextMessage: {
      text: "@2348000000002 who is this?",
      contextInfo: { mentionedJid: ["2348000000002@s.whatsapp.net"] }
    }
  };
  await processMessage(deps, nonOwnerSock, ask);
  const reply = sent.map(item => item.content?.text || "").find(Boolean) || "";
  assert.match(reply, /Good evening/, "in public mode the AI answers the member directly");
  assert.equal(groqCalls.length, 1, "the AI brain ran, not the receptionist");
  // and the boxed list is theirs to pull, like on the classic bots
  sent.length = 0;
  const memberMenu = textMessage(".menu", { jid: "123@g.us", fromMe: false });
  memberMenu.key.participant = "2348555000009@s.whatsapp.net";
  await processMessage(deps, nonOwnerSock, memberMenu);
  const menu = sent.map(item => item.content?.text || item.content?.caption || "").join("\n");
  assert.match(menu, /╭──〔 DamzD 〕/, "a group member pulls the boxed list");
  assert.match(menu, /✦ 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗚𝗥𝗘𝗔𝗧 𝗗𝗔𝗠𝗭𝗗/);
  // back to private: the same mention gets the receptionist again
  deps.store.set("accessmode", "private");
  sent.length = 0;
  groqCalls.length = 0;
  deps.ownerActivity.delete("123@g.us");
  await new Promise(resolve => setTimeout(resolve, 2600));
  // a fresh message object — the bot skips message ids it has already handled
  const ask2 = textMessage("@2348000000002 who is this?", { jid: "123@g.us", fromMe: false });
  ask2.key.participant = "2348555000009@s.whatsapp.net";
  ask2.message = {
    extendedTextMessage: {
      text: "@2348000000002 who is this?",
      contextInfo: { mentionedJid: ["2348000000002@s.whatsapp.net"] }
    }
  };
  await processMessage(deps, nonOwnerSock, ask2);
  const quiet = sent.map(item => item.content?.text || "").find(Boolean) || "";
  assert.match(quiet, /he is free/, "private mode restores the receptionist");
  assert.equal(groqCalls.length, 0, "no AI call in private mode");
  setAccessMode("self");
});

await check(".song asks for a query when none is given", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".song"));
  assert.match(firstText(), /tell me the song or artist name/);
});

await check("the music pipeline pins its picks: best m4a, honest artists, video ids", async () => {
  const { pickBestAudio, pickBestVideo, youtubeVideoId } = await import("../src/downloads.js");
  const streams = [
    { mimeType: "video/mp4", bitrate: 900000, url: "https://x/video" },
    { mimeType: "audio/webm", bitrate: 160000, url: "https://x/webm" },
    { mimeType: "audio/mp4", bitrate: 129000, url: "https://x/a129" },
    { mimeType: "audio/mp4", bitrate: 256000, url: "https://x/a256" }
  ];
  assert.equal(pickBestAudio(streams), "https://x/a256", "the highest-bitrate m4a wins");
  assert.equal(pickBestAudio([]), null);
  assert.equal(pickBestVideo(streams), "https://x/video");
  const mixed = [
    { mimeType: "video/mp4", bitrate: 700000, videoOnly: true, url: "https://x/vid-only" },
    { mimeType: "video/mp4", bitrate: 400000, videoOnly: false, url: "https://x/combined" }
  ];
  assert.equal(pickBestVideo(mixed), "https://x/combined", "video-only streams never ship as a playable clip");
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=aBcD_ef&t=1"), "aBcD_ef");
  assert.equal(youtubeVideoId("https://youtu.be/aBcD_ef"), "aBcD_ef");
  assert.equal(youtubeVideoId("https://www.youtube.com/shorts/aBcD_ef"), "aBcD_ef");
  assert.equal(youtubeVideoId("https://example.com/not-youtube"), "");
  const { pickAudiusTrack } = await import("../src/audius.js");
  const tracks = [
    { id: "R1", title: "Faouzia - Unethical (Remix)", duration: 396, user: { name: "CryJaxx" } },
    { id: "T1", title: "UNETHICAL", duration: 30, user: { name: "Faouzia" } },
    { id: "T2", title: "UNETHICAL", duration: 197, user: { name: "Faouzia" } }
  ];
  const hit = pickAudiusTrack(tracks, "Faouzia");
  assert.equal(hit?.id, "T2", "another artist's remix and a teaser never pass as the real song");
  assert.equal(pickAudiusTrack(tracks, ""), null);
});

await check("view-once stanzas are cached so anyone can recover what the bot could see", async () => {
  const { stashViewOnce, findCachedViewOnce, viewOnceCacheSize } = await import("../src/viewonce.js");
  // A member sends the bot a view-once photo in their DM — the raw stanza
  // carries the full media metadata even though no client may re-show it.
  const vo = {
    key: { remoteJid: "2348777666555@s.whatsapp.net", fromMe: false, id: "VONCE-TEST-1" },
    message: {
      viewOnceMessageV2: {
        message: { imageMessage: { url: "https://mmg.whatsapp.net/v/t62.7118-24/test", directPath: "/v/t62.7118-24/test", mediaKey: "abc=", mimetype: "image/jpeg" } }
      }
    }
  };
  await processMessage(deps, nonOwnerSock, vo);
  const hit = findCachedViewOnce("2348777666555@s.whatsapp.net", "VONCE-TEST-1");
  assert.ok(hit, "the view-once stanza is remembered");
  assert.equal(hit.kind, "image");
  assert.equal(findCachedViewOnce("2348777666555@s.whatsapp.net", "NOT-THE-ONE"), null, "a wrong stanza id finds nothing");
  // The cache stays bounded — 400 entries, oldest evicted first.
  for (let i = 0; i < 405; i += 1) {
    stashViewOnce({
      key: { remoteJid: "2348000000009@s.whatsapp.net", id: "FLOOD-" + i },
      message: { viewOnceMessage: { message: { imageMessage: { mimetype: "image/jpeg" } } } }
    });
  }
  assert.ok(viewOnceCacheSize() <= 400, "the cache prunes itself");
});

await check(".Ggs recovery failures stay silent for members and note the owner only", async () => {
  setAccessMode("public");
  // A member quotes a view-once whose stanza the bot never saw (it was sent
  // in a chat the bot is not part of): nothing may leak — no reply anywhere.
  sent.length = 0;
  const strangerQuote = textMessage(".Ggs", { jid: "2348777666555@s.whatsapp.net", fromMe: false });
  strangerQuote.key.participant = "2348777666555@s.whatsapp.net";
  strangerQuote.message = {
    extendedTextMessage: {
      text: ".Ggs",
      contextInfo: { stanzaId: "FOREIGN-STANZA-9", quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } } }
    }
  };
  await processMessage(deps, nonOwnerSock, strangerQuote);
  const memberTexts = sent.filter(item => item.content?.text);
  assert.equal(memberTexts.length, 0, "a failed recovery never tells the room");
  // The owner quoting an un-cached, stripped view-once gets the quiet note
  // in their own chat — the old failure path, unchanged.
  sent.length = 0;
  const ownerQuote = textMessage(".Ggs", { jid: "2348000000001@s.whatsapp.net", fromMe: true });
  ownerQuote.message = {
    extendedTextMessage: {
      text: ".Ggs",
      contextInfo: { stanzaId: "FOREIGN-STANZA-9", quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } } }
    }
  };
  await processMessage(deps, ownerSock, ownerQuote);
  const note = sent.map(item => item.content?.text || "").find(Boolean) || "";
  assert.match(note, /could not recover that one/, "the owner still gets the failure note");
  assert.match(note, /never reached me/, "the owner learns the real reason, not Baileys' cryptic URL error");
  setAccessMode("self");
});

await check("content-withheld arrival is cached, re-requested from the phone, and explained", async () => {
  setAccessMode("self");
  sent.length = 0;
  resendRequests.length = 0;
  // The 22 Nov Render logs proved this shape: an upsert line for the id, no
  // media line, then "never reached me". The arrival carries key.id but NO
  // message — the linked-device "unavailable fanout" of a view-once.
  const stub = { key: { remoteJid: "251814620463268@lid", id: "WITHHELD-STUB-1", fromMe: false, participant: "251814620463268@lid" } };
  await processMessage(deps, ownerSock, stub);
  assert.equal(resendRequests.length, 1, "placeholder resend requested exactly once");
  assert.equal(resendRequests[0].id, "WITHHELD-STUB-1", "the resend targets the withheld id");
  const note = sent.map(item => item.content?.text || "").find(Boolean) || "";
  assert.match(note, /without content/, "the owner learns what happened");
  assert.match(note, /re-serve/, "the owner learns what to expect");
  assert.doesNotMatch(note, /never reached me/, "the misleading note is gone for arrivals the bot did receive");
});

await check("reacting to a still-withheld message explains the wall instead of 'never reached me'", async () => {
  sent.length = 0;
  const stub = { key: { remoteJid: "251814620463268@lid", id: "WITHHELD-STUB-2", fromMe: false, participant: "251814620463268@lid" } };
  await processMessage(deps, ownerSock, stub); // cache the withheld stub
  sent.length = 0;
  const reaction = {
    key: { remoteJid: "251814620463268@lid", fromMe: true, id: "REACT-W2" },
    message: { reactionMessage: { text: "❤️", key: { remoteJid: "251814620463268@lid", id: "WITHHELD-STUB-2", fromMe: false, participant: "251814620463268@lid" } } }
  };
  await processMessage(deps, ownerSock, reaction);
  const note = sent.map(item => item.content?.text || "").find(Boolean) || "";
  assert.match(note, /withheld/, "the owner gets the withheld explanation");
  assert.match(note, /resend it now/, "the note points to the fix");
  assert.doesNotMatch(note, /never reached me/, "the old misleading note is gone for received ids");
});

await check(".vvinfo reads the cached original, not the always-unwrapped quote", async () => {
  const { cacheMessage } = await import("../src/cache.js");
  // The quote arrives unwrapped (bare imageMessage) — WhatsApp strips the
  // view-once wrapper from quoted copies, which made .vvinfo say "false"
  // for a real view-once. The snapshot of the original arrival knows better.
  cacheMessage("VV-ORIG-1", {
    jid: "251814620463268@lid", sender: "251814620463268@lid", text: "",
    node: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", url: "https://mmg.whatsapp.net/x.jpg", mediaKey: "abc" } } } }
  });
  cacheMessage("VV-WITHHELD-1", { jid: "251814620463268@lid", sender: "251814620463268@lid", text: "", node: null });
  sent.length = 0;
  const reply = stanzaId => ({
    key: { remoteJid: "2348000000001@s.whatsapp.net", fromMe: true, id: "VV-INFO-" + stanzaId },
    pushName: "Tester",
    message: { extendedTextMessage: { text: ".vvinfo", contextInfo: { stanzaId, participant: "251814620463268@lid", quotedMessage: { imageMessage: { mimetype: "image/jpeg" } } } } }
  });
  await processMessage(deps, ownerSock, reply("VV-ORIG-1"));
  assert.match(firstText(), /View-once: true/, "the cached original reveals the view-once wrapper");
  assert.match(firstText(), /Arrival id/, "the arrival id is shown for reference");
  sent.length = 0;
  await processMessage(deps, ownerSock, reply("VV-WITHHELD-1"));
  assert.match(firstText(), /WITHOUT content/, "a withheld arrival is reported as withheld, not 'false'");
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
  assert.ok(lookup.has("fable"), "the remaining flagship command is present");
  for (const name of ["astra", "sol", "terra", "luna", "llama", "ai", "hello", "wormgpt", "qwen", "fable5", "gitclone"]) {
    assert.ok(!lookup.has(name), "removed command must be gone: " + name);
  }
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

await check(".disconnect from chat wipes a connected friend's session", async () => {
  const path = await import("node:path");
  const os = await import("node:os");
  const { SessionManager } = await import("../src/sessions.js");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "damzd-disc-cmd-"));
  const dummy = path.join(tmp, "dummy.js");
  fs.writeFileSync(dummy, "setTimeout(function(){}, 6e10);");
  const mgr = new SessionManager({ dataDirectory: tmp, entryPath: dummy });
  await mgr.connect("08010000004");
  deps.sessions = mgr;
  try {
    sent.length = 0;
    await processMessage(deps, ownerSock, textMessage(".disconnect 08010000004"));
    assert.match(firstText(), /disconnected — their bot is stopped and the WhatsApp link is wiped/);
    assert.equal(mgr.children.has("2348010000004"), false, "their bot process is dead");
    assert.equal(mgr.readStatuses().some(row => row.number === "2348010000004"), false, "the session is gone from the registry, not just banned");
    // a number that never connected gets a friendly pointer to .ban instead
    sent.length = 0;
    await processMessage(deps, ownerSock, textMessage(".disconnect 2348099999999"));
    assert.match(firstText(), /no connected bot here/);
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

await check(".menu delivers the bot picture and the menu as ONE captioned message", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".menu"));
  const sends = sent.filter(item => !item.content.react); // the ⚡ ack is a reaction, not a message
  assert.equal(sends.length, 1, "one message only: the picture with the menu as its caption");
  assert.ok(Buffer.isBuffer(sends[0].content.image), "the picture carries the text");
  const menu = String(sends[0].content.caption || "");
  assert.match(menu, /DamzD/);
  assert.match(menu, /SECTIONS|𝗦𝗘𝗖𝗧𝗜𝗢𝗡𝗦/);
  assert.match(menu, /GREAT DAMZD|𝗚𝗥𝗘𝗔𝗧 𝗗𝗔𝗠𝗭𝗗/);
});

await check(".help delivers the picture and the full list as ONE captioned message", async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage(".help"));
  const sends = sent.filter(item => !item.content.react); // the ⚡ ack is a reaction, not a message
  assert.equal(sends.length, 1, "one message only: the picture with the list as its caption");
  assert.ok(Buffer.isBuffer(sends[0].content.image), "the picture carries the text");
  const help = String(sends[0].content.caption || "");
  assert.ok(help.length > 500, "the caption is the full list, not a stub");
  assert.match(help, /ping/i);
  assert.match(help, /menu/i);
});

await check("connectNote greets the owner in the menu's look", async () => {
  const { connectNote } = await import("../commands/general.js");
  const note = connectNote({ name: "DamzD", prefix: "." });
  assert.match(note, /connected and online/);
  assert.match(note, /1\.4\.44/);
  assert.match(note, /PREFIX|𝗣𝗥𝗘𝗙𝗜𝗫/);
  assert.match(note, /OWNER|𝗢𝗪𝗡𝗘𝗥/);
  assert.match(note, /MODE|𝗠𝗢𝗗𝗘/);
  assert.match(note, /UPTIME|𝗨𝗣𝗧𝗜𝗠𝗘/);
  assert.match(note, /menu/);
});

await check("botImagePayload handles URLs, files and missing files", async () => {
  const { botImagePayload } = await import("../src/utils.js");
  const asUrl = botImagePayload({ botImage: "https://example.com/pic.jpg" });
  assert.deepEqual(asUrl, { image: { url: "https://example.com/pic.jpg" } });
  const asFile = botImagePayload({ botImage: "assets/bot-image.png" });
  assert.ok(Buffer.isBuffer(asFile.image), "local file becomes a Buffer");
  assert.equal(botImagePayload({ botImage: "assets/does-not-exist.png" }), null);
  assert.equal(botImagePayload({ botImage: "" }), null);
});

await check('bare "ggs" with no dot runs the recovery skin — owner AND friends', async () => {
  sent.length = 0;
  await processMessage(deps, ownerSock, textMessage("ggs"));
  assert.match(firstText(), /GG|good game/i, "bare ggs routes exactly like .Ggs");
  setAccessMode("public");
  sent.length = 0;
  await processMessage(deps, nonOwnerSock, textMessage("ggs", { jid: "2348000000009@s.whatsapp.net", fromMe: false }));
  assert.match(firstText(), /GG|good game/i, "a friend's bare ggs works too in public mode");
  setAccessMode("self");
  sent.length = 0;
  await processMessage(deps, nonOwnerSock, textMessage("ggs", { jid: "2348000000009@s.whatsapp.net", fromMe: false }));
  assert.doesNotMatch(firstText(), /GGs! 🎮/, "in self mode only the owner's bare words count");
});

await check("anti-delete reports text deletions and stays silent when media expires", async () => {
  const { cacheMessage } = await import("../src/cache.js");
  const { runSideEffects } = await import("../src/hooks.js");
  deps.store.set("antidelOn", true);
  sent.length = 0;
  cacheMessage("del-text-1", { jid: "2348000000003@s.whatsapp.net", sender: "2348000000003", text: "this will vanish", node: { conversation: "this will vanish" } });
  await runSideEffects(ownerSock, deps, {
    key: { id: "proto-1", remoteJid: "2348000000003@s.whatsapp.net" },
    message: { protocolMessage: { type: 0, key: { id: "del-text-1", remoteJid: "2348000000003@s.whatsapp.net" } } }
  });
  assert.ok(sent.some(item => String(item.content?.text || "").includes("deleted a message")), "text deletion is reported to the owner");
  sent.length = 0;
  cacheMessage("del-img-1", { jid: "2348000000003@s.whatsapp.net", sender: "2348000000003", text: "", node: { imageMessage: { mimetype: "image/jpeg" } } });
  await runSideEffects(ownerSock, deps, {
    key: { id: "proto-2", remoteJid: "2348000000003@s.whatsapp.net" },
    message: { protocolMessage: { type: 0, key: { id: "del-img-1", remoteJid: "2348000000003@s.whatsapp.net" } } }
  });
  assert.equal(sent.length, 0, "media whose blob is already gone stays silent, no crash");
});

await check("bare words: song in a GC with no dot; menu stays dot-only there", async () => {
  const { resolveBareCommand } = await import("../src/runtime.js");
  assert.deepEqual(resolveBareCommand("song darlene hello", true), { name: "song", args: "darlene hello" }, '"song <name>" in a GC fetches the song');
  assert.deepEqual(resolveBareCommand("play cold water", true), { name: "play", args: "cold water" });
  assert.deepEqual(resolveBareCommand("save", false), { name: "save", args: "" });
  assert.deepEqual(resolveBareCommand("save dp", false), { name: "pp", args: "" }, '"save dp" is the profile-picture command');
  assert.deepEqual(resolveBareCommand("Save profile picture", true), { name: "pp", args: "" }, "works bare in a GC too");
  assert.deepEqual(resolveBareCommand("menu", false), { name: "menu", args: "" }, "DMs get the info words bare");
  assert.equal(resolveBareCommand("menu", true), null, "in a GC menu still wants the dot");
  assert.equal(resolveBareCommand("how far", true), null, "plain talk never parses as a command");
  assert.equal(resolveBareCommand(".song x", true), null, "dotted text goes through the dot path");
});

await check(".prefix moves the command mark and the store remembers it", async () => {
  const { config: appConfig } = await import("../src/config.js");
  const fakeStore = { saved: null, set(key, value) { this.saved = [key, value]; } };
  const replies = [];
  const prefixCommand = lookup.get("prefix");
  assert.ok(prefixCommand, "the prefix command is registered in the OWNER section");
  await assert.rejects(
    () => prefixCommand.run({ isOwner: false, args: "!", store: fakeStore, reply: t => replies.push(t) }),
    /owner/,
    "non-owners cannot move the mark"
  );
  await prefixCommand.run({ isOwner: true, args: "!", store: fakeStore, reply: t => replies.push(t) });
  assert.equal(appConfig.prefix, "!", "the mark changed to !");
  assert.deepEqual(fakeStore.saved, ["prefix", "!"], "the store keeps it for the next boot");
  assert.match(replies.at(-1), /!\* \(e\.g\. !menu\)/);
  await prefixCommand.run({ isOwner: true, args: ".", store: fakeStore, reply: t => replies.push(t) });
  assert.equal(appConfig.prefix, ".", "back to the dot");
  await prefixCommand.run({ isOwner: true, args: "nope", store: fakeStore, reply: t => replies.push(t) });
  assert.match(replies.at(-1), /1-3 symbols/, "letters are refused — symbols only");
  assert.equal(appConfig.prefix, ".", "a refused mark leaves the dot untouched");
});

await check("reaction-save: reacting to a view-once pulls it back — access-gated", async () => {
  const chat = "2348000000009@s.whatsapp.net";
  const viewOnce = {
    key: { remoteJid: chat, fromMe: false, id: "VV-REACT-1" },
    message: { viewOnceMessageV2: { message: { imageMessage: {
      url: "https://mmg.whatsapp.net/v/t62.7118-24/missing.jpg",
      directPath: "/mms/image/missing",
      mimetype: "image/jpeg",
      caption: "look quick",
      fileEncSha256: "AAAA",
      mediaKey: "BBBB"
    } } } }
  };
  sent.length = 0;
  await processMessage(deps, nonOwnerSock, viewOnce);
  assert.equal(sent.length, 1, "the arrival now notes the capture exactly once");
  assert.match(firstText(), /View-once remembered/, "the capture note makes the stash observable");
  assert.equal(sent[0].jid, "2348000000002@s.whatsapp.net", "the capture note goes to the bot's own account chat only");

  const react = (targetId, fromMe) => ({
    key: { remoteJid: chat, fromMe: Boolean(fromMe), id: "REACT-" + Math.random().toString(36).slice(2) },
    message: { reactionMessage: { key: { remoteJid: chat, id: targetId, fromMe: false }, text: "👀" } }
  });

  setAccessMode("self");
  sent.length = 0;
  await processMessage(deps, nonOwnerSock, react("VV-REACT-1"));
  assert.equal(sent.length, 0, "self mode: only the owner's reaction can pull");

  setAccessMode("public");
  sent.length = 0;
  await processMessage(deps, nonOwnerSock, react("VV-REACT-1"));
  assert.equal(sent.length, 0, "public mode: the pull runs but a failed fetch stays silent in the chat");

  sent.length = 0;
  await processMessage(deps, ownerSock, react("VV-REACT-1", true));
  assert.match(firstText(), /could not be pulled back/, "the owner's reaction earns a quiet note in his own chat");
  assert.equal(sent[0].jid, "2348000000001@s.whatsapp.net", "the note goes to the owner's own chat only");

  sent.length = 0;
  const removal = react("VV-REACT-1", true);
  removal.message.reactionMessage.text = "";
  await processMessage(deps, ownerSock, removal);
  assert.equal(sent.length, 0, "removing a reaction is never a trigger");

  sent.length = 0;
  await processMessage(deps, nonOwnerSock, react("NOT-IN-STORE"));
  assert.equal(sent.length, 0, "reacting to a normal message does nothing");
  setAccessMode("self");
});

await check("view-once stash catches ephemeral-wrapped view-onces", async () => {
  const { findCachedViewOnce } = await import("../src/viewonce.js");
  const chat = "2348000000019@s.whatsapp.net";
  sent.length = 0;
  await processMessage(deps, nonOwnerSock, {
    key: { remoteJid: chat, fromMe: false, id: "VV-EPH-1" },
    message: { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: {
      url: "https://mmg.whatsapp.net/v/t62.7118-24/eph.jpg", directPath: "/mms/image/eph", mimetype: "image/jpeg"
    } } } } } }
  });
  assert.equal(sent.length, 1, "the ephemeral view-once also notes its capture");
  assert.match(firstText(), /View-once remembered/, "the stash announces itself");
  assert.ok(findCachedViewOnce(chat, "VV-EPH-1"), "the stash found it UNDER the ephemeral wrapper");
});

await check("universal stash remembers plain media in any wrapper shape", async () => {
  const { stashRememberMedia, findCachedViewOnce } = await import("../src/viewonce.js");
  const chat = "2348000000029@s.whatsapp.net";
  // Plain media under a wrapper the code has never heard of — no view-once
  // marker anywhere. The deep walk must still remember it.
  assert.ok(stashRememberMedia({
    key: { remoteJid: chat, fromMe: false, id: "MEDIA-ANY-1" },
    message: { someFutureWrapper: { message: { imageMessage: {
      url: "https://mmg.whatsapp.net/v/t62.7118-24/plain.jpg", mimetype: "image/jpeg"
    } } } }
  }), "any media node anywhere in the tree gets remembered");
  const found = findCachedViewOnce(chat, "MEDIA-ANY-1");
  assert.ok(found, "the recovery lookup finds the remembered media");
  assert.equal(found.node.url, "https://mmg.whatsapp.net/v/t62.7118-24/plain.jpg", "the node comes back intact");
  assert.equal(found.wasViewOnce, false, "it is not masquerading as a view-once");
  assert.equal(stashRememberMedia({
    key: { remoteJid: chat, fromMe: false, id: "MEDIA-ANY-1" },
    message: { imageMessage: { url: "https://mmg.whatsapp.net/other.jpg" } }
  }), false, "an already-remembered id is left alone");
});

await check("reaction falls back to the anti-delete snapshot (view-once only)", async () => {
  const { cacheMessage } = await import("../src/cache.js");
  const chat = "2348000000019@s.whatsapp.net";
  // An ephemeral-wrapped view-once that the stash lost — only the snapshot has it.
  cacheMessage("VV-SNAP-9", { jid: chat, node: { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: {
    url: "https://mmg.whatsapp.net/v/t62.7118-24/snap.jpg", directPath: "/mms/image/snap", mimetype: "image/jpeg"
  } } } } } } });
  // A plain photo — reactions to it must stay no-ops.
  cacheMessage("PLAIN-SNAP-9", { jid: chat, node: { imageMessage: { url: "https://mmg.whatsapp.net/v/t62.7118-24/plain.jpg", mimetype: "image/jpeg" } } });
  const reactTo = id => ({
    key: { remoteJid: chat, fromMe: true, id: "REACT-" + Math.random().toString(36).slice(2) },
    message: { reactionMessage: { key: { remoteJid: chat, id, fromMe: false }, text: "👀" } }
  });
  sent.length = 0;
  await processMessage(deps, ownerSock, reactTo("PLAIN-SNAP-9"));
  assert.equal(sent.length, 0, "a plain photo's reaction never triggers anything");
  sent.length = 0;
  await processMessage(deps, ownerSock, reactTo("VV-SNAP-9"));
  assert.match(firstText(), /could not be pulled back/, "the snapshot fallback found the view-once (fetch then failed — owner note proves the path ran)");
  setAccessMode("self");
});

await check("searchQuality: an artist-only match for a multi-word query is weak", async () => {
  const { searchQuality } = await import("../src/apis.js");
  // the real failure: "altare btw" announced "Altare — Surge" as Found it
  assert.equal(searchQuality("altare btw", { title: "Surge", artist: "Altare" }), "weak");
  assert.equal(searchQuality("altare bye", { title: "bye (slowed)", artist: "Altare" }), "strong");
  assert.equal(searchQuality("cold water", { title: "Cold Water", artist: "Major Lazer" }), "strong");
  assert.equal(searchQuality("rema", { title: "Calm Down", artist: "Rema" }), "strong", "one-word artist searches keep working");
  assert.equal(searchQuality("darlene", { title: "Hello", artist: "Omolara" }), "weak", "different words do not pass");
});

await check("the media snapshot survives restarts via messages.json", async () => {
  const cache = await import("../src/cache.js");
  const fsp = await import("node:fs");
  const nodePath = await import("node:path");
  const dir = nodePath.join(process.cwd(), "test", ".tmp-snapshot");
  fsp.rmSync(dir, { recursive: true, force: true });
  cache.initMessageStore(dir);
  cache.cacheMessage("SNAP-PERSIST-1", { jid: "2348000000001@s.whatsapp.net", node: { imageMessage: { url: "https://x/y.jpg" } } });
  cache.cacheMessage("SNAP-TEXT-1", { jid: "2348000000001@s.whatsapp.net", text: "plain words" });
  cache.flushMessages();
  assert.ok(fsp.existsSync(nodePath.join(dir, "messages.json")), "the file was written");
  // a fresh module state — what a restart looks like
  const fresh = await import("../src/cache.js?fresh=1");
  fresh.initMessageStore(dir);
  assert.ok(fresh.getCached("SNAP-PERSIST-1"), "the media node came back after the restart");
  assert.equal(fresh.getCached("SNAP-TEXT-1"), null, "text-only entries are not persisted");
  fsp.rmSync(dir, { recursive: true, force: true });
});

await check("reaction to a message the bot never received notes the owner instead of silence", async () => {
  const chat = "2348000000019@s.whatsapp.net";
  sent.length = 0;
  await processMessage(deps, ownerSock, {
    key: { remoteJid: chat, fromMe: true, id: "REACT-UNKNOWN-1" },
    message: { reactionMessage: { key: { remoteJid: chat, id: "NEVER-SEEN-42", fromMe: false }, text: "👀" } }
  });
  assert.match(firstText(), /never reached me/, "the owner learns why nothing was pulled");
  assert.match(firstText(), /media messages remembered since boot/, "the note reports stash coverage");
  // reacting to a known plain-text message stays a silent no-op
  const { cacheMessage } = await import("../src/cache.js");
  cacheMessage("PLAINTEXT-1", { jid: chat, text: "just talking", node: { conversation: "just talking" } });
  sent.length = 0;
  await processMessage(deps, ownerSock, {
    key: { remoteJid: chat, fromMe: true, id: "REACT-PLAINTEXT-1" },
    message: { reactionMessage: { key: { remoteJid: chat, id: "PLAINTEXT-1", fromMe: false }, text: "👀" } }
  });
  assert.equal(sent.length, 0, "reactions to ordinary messages never trigger anything");
});

memory.saveNow();
console.log("\nAll " + passed + " checks passed. DamzD behaves like a human, runs commands, and never advertises.");
