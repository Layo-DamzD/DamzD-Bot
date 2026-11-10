// v1.4.3 checks: group owner recognition (LID + fromMe), group AI replies,
// command reaction, message dedup, and the JioSaavn song engine.
import process from "node:process";

process.env.OWNER_NUMBER = "2347087299884";
process.env.ACCESS_MODE = "self";
process.env.PREFIX = ".";
process.env.AUTO_DL = "false";
delete process.env.GROQ_API_KEY; // AI brain off — she should still reply with guidance

const { createContext } = await import("../src/context.js");
const { numberFromJid } = await import("../src/utils.js");
const { processMessage, isBotMention } = await import("../src/runtime.js");
const { loadCommands, buildLookup } = await import("../src/loader.js");
const { decryptMediaUrl, searchSong } = await import("../src/saavn.js");

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log("  ok  " + name);
  } else {
    failed += 1;
    console.log("  FAIL " + name + (detail ? " — " + detail : ""));
  }
}

const ownJid = "2347087299884:12@s.whatsapp.net";
const ownLid = "111222333:5@lid";
const fakeSock = {
  user: { id: ownJid, lid: ownLid },
  sendMessage: async () => ({ key: { id: "X", fromMe: true } }),
  sendPresenceUpdate: async () => {},
  groupMetadata: async () => null
};

// 1) owner detection in groups — the LID regression
const groupJid = "120363021456789@g.us";
const mkCtx = key => createContext({ sock: fakeSock, msg: { key }, config: { prefix: "." }, store: { get: () => undefined, set: () => {} }, memory: { remember: () => {}, history: () => [] } });

check("group message from owner's phone (LID participant) is owner", mkCtx({ remoteJid: groupJid, fromMe: true, id: "A1", participant: ownLid }).isOwner === true);
check("group message from owner's phone (JID participant) is owner", mkCtx({ remoteJid: groupJid, fromMe: true, id: "A2", participant: ownJid }).isOwner === true);
check("group message from another member is NOT owner", mkCtx({ remoteJid: groupJid, fromMe: false, id: "A3", participant: "999888777:1@lid" }).isOwner === false);
check("DM from owner is owner", mkCtx({ remoteJid: "2347087299884@s.whatsapp.net", fromMe: true, id: "A4" }).isOwner === true);
check("numberFromJid strips device and domain", numberFromJid("2347087299884:12@s.whatsapp.net") === "2347087299884");

// 2) mention detection covers @lid and phone forms
const mentionMsg = mentioned => ({ message: { extendedTextMessage: { text: "hi", contextInfo: { mentionedJid: mentioned } } } });
check("mention via phone JID detected", isBotMention({ sock: fakeSock }, mentionMsg(["2347087299884@s.whatsapp.net"])) === true);
check("mention via LID detected", isBotMention({ sock: fakeSock }, mentionMsg(["111222333@lid"])) === true);
check("mention of someone else not detected", isBotMention({ sock: fakeSock }, mentionMsg(["999888777@s.whatsapp.net"])) === false);

// 3) full pipeline: an owner message in a group must produce a reply
const commands = await loadCommands(new URL("../commands/", import.meta.url).pathname);
const lookup = buildLookup(commands);
const processed = new Set();
const store = { get: () => undefined, set: () => {} };
const memory = { remember: () => {}, history: () => [] };
const sent = [];
const liveSock = {
  user: { id: ownJid, lid: ownLid },
  sendPresenceUpdate: async () => {},
  groupMetadata: async () => null,
  sendMessage: async (jid, content) => {
    sent.push({ jid, content });
    return { key: { id: "SENT" + (sent.length), fromMe: true } };
  }
};
const deps = { processed, store, memory, lookup, commands };

const chat = { remoteJid: groupJid, fromMe: true, id: "MSG1", participant: ownLid };
await processMessage(deps, liveSock, { key: chat, message: { conversation: "hello there, are you awake?" } });
check("group chat from owner gets an AI-path reply", sent.some(s => typeof s.content?.text === "string" && s.content.text.length > 5));

// 4) command in a group: ⚡ reaction + a response
const cmdStart = sent.length;
await processMessage(deps, liveSock, { key: { remoteJid: groupJid, fromMe: true, id: "MSG2", participant: ownLid }, message: { conversation: ".ping" } });
check("command gets a ⚡ reaction", sent.slice(cmdStart).some(s => s.content?.react?.text === "⚡"));
check("command produces a text reply", sent.slice(cmdStart + 1).some(s => typeof s.content?.text === "string"));

// 5) dedup: the loop guard relies on processed ids being skipped
const before = sent.length;
await processMessage(deps, liveSock, { key: { remoteJid: groupJid, fromMe: true, id: "MSG2", participant: ownLid }, message: { conversation: ".ping" } });
check("already-processed message id is skipped", sent.length === before);

// 6) JioSaavn song engine (live network)
try {
  const song = await searchSong("alan walker faded");
  check("JioSaavn finds 'Faded'", song.title.toLowerCase().includes("faded"), JSON.stringify(song.title));
  check("decrypted stream URL is a valid CDN link", /^https:\/\/aac\.saavncdn\.com\/.+\.mp4$/.test(song.url320), song.url320.slice(0, 60));
  check("decryptMediaUrl is safe on empty input", decryptMediaUrl("") === "");
} catch (error) {
  check("JioSaavn search reachable", false, error?.message || "unknown error");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
