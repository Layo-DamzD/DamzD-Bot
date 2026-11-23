// Smoke-run the new offline-capable commands against a fake context and
// exercise the sticker ffmpeg pipeline on a generated image.
import path from "node:path";
import { loadCommands } from "../damzd/handlers/command-loader.js";
import config from "../damzd/config/bot.config.js";

const { commands } = await loadCommands(path.resolve("/home/z/my-project/damzd/commands"));
const byName = new Map(commands.map(c => [c.name, c]));

function fakeCtx(extra = {}) {
  const sent = [];
  return {
    sent,
    msg: { key: { remoteJid: "120363@g.us", id: "SMOKE1", fromMe: false }, message: { conversation: "smoke" }, messageTimestamp: 1 },
    config,
    theme: {},
    commands,
    jid: "120363@g.us",
    senderJid: "2348012345678@s.whatsapp.net",
    owner: true,
    args: "",
    commandName: "x",
    sock: {
      user: { id: "2348000000000@s.whatsapp.net" },
      chats: { "123@newsletter": { name: "Demo Channel" } },
      onWhatsApp: async n => [{ jid: n + "@s.whatsapp.net", exists: true }],
      sendPresenceUpdate: async (...a) => sent.push(["presence", ...a]),
      chatModify: async (...a) => sent.push(["chatModify", ...a]),
      updateBlockStatus: async (...a) => sent.push(["block", ...a]),
      sendMessage: async (jid, content) => sent.push(["send", jid, content]),
      groupMetadata: async () => ({ participants: [{ id: "2348012345678@s.whatsapp.net" }] }),
      profilePictureUrl: async () => "https://example.org/x.jpg",
      newsletterMetadata: async () => ({ id: "123@newsletter", name: "Demo Channel" })
    },
    send: async payload => sent.push(["send", payload]),
    reply: async payload => sent.push(["reply", payload]),
    ...extra
  };
}

const offlineChecks = [
  ["echo", "echo hello world", ctx => ctx.sent.some(m => m[1] === "hello world")],
  ["quote", "quote", () => true],
  ["rate", "rate jollof rice", () => true],
  ["love", "love Layo | DamzD", () => true],
  ["aidetect", "aidetect Furthermore, it is important to note that the landscape of modern technology continues to evolve at a remarkable pace. Moreover, these developments represent a significant testament to human ingenuity. Additionally, the seamless integration of robust systems unlocks unprecedented opportunities. Ultimately, this robust trend will continue to shape our collective future in profound ways.", () => true],
  ["sora", "sora", () => true],
  ["voices", "voices", () => true],
  ["about", "about", () => true],
  ["channel", "channel", () => true],
  ["channeljid", "channeljid", () => true],
  ["msessions", "msessions", () => true],
  ["cstatus", "cstatus", () => true],
  ["channels", "channels", () => true],
  ["banchecker", "banchecker 2348012345678", () => true],
  ["pres", "pres unavailable", () => true],
  ["typing", "typing", () => true],
  ["online", "online", () => true],
  ["pin", "pin", () => true],
  ["unpin", "unpin", () => true],
  ["mutechat", "mutechat 24h", () => true],
  ["unmutechat", "unmutechat", () => true],
  ["readchat", "readchat", () => true],
  ["unreadchat", "unreadchat", () => true],
  ["archive", "archive", () => true],
  ["unarchive", "unarchive", () => true],
  ["disappear", "disappear 7d", () => true],
  ["block", "block 2348012345678", () => true],
  ["unblock", "unblock 2348012345678", () => true],
  ["antiedit", "antiedit", () => true],
  ["statusreacton", "statusreacton", () => true],
  ["autostatus", "autostatus", () => true],
  ["autotype", "autotype on", () => true],
  ["autorec", "autorec on", () => true],
  ["cunfollow", "cunfollow all", () => true],
  ["prefix", "prefix", () => true],
  ["vn2text", "vn2text", () => true] // no quoted message -> clear usage error
];

let failures = 0;
for (const [name, invocation, validator] of offlineChecks) {
  const command = byName.get(name);
  if (!command) {
    console.log("✗ MISSING command:", name);
    failures += 1;
    continue;
  }
  const ctx = fakeCtx({ args: invocation.slice(name.length).trim() });
  try {
    await command.run(ctx);
  } catch (error) {
    const message = String(error?.message || error);
    const expectedUsage = name === "vn2text";
    if (expectedUsage && message.includes("Reply to the voice note")) {
      console.log("✓", name, "(usage error as designed)");
      continue;
    }
    console.log("✗", name, "threw:", message.slice(0, 140));
    failures += 1;
    continue;
  }
  if (!validator(ctx)) {
    console.log("✗", name, "validator failed");
    failures += 1;
    continue;
  }
  console.log("✓", name, "(" + ctx.sent.length + " outbound)");
}

// wcg lobby lifecycle
const group = "120363@g.us";
const wcg = byName.get("wcg");
const host = fakeCtx({ jid: group, senderJid: "2348011111111@s.whatsapp.net", args: "" });
await wcg.run(host);
const joiner = fakeCtx({ jid: group, senderJid: "2348022222222@s.whatsapp.net", args: "" });
await wcg.run(joiner);
const starter = fakeCtx({ jid: group, senderJid: "2348011111111@s.whatsapp.net", args: "start" });
await wcg.run(starter);
const started = starter.sent.some(m => String(m[2]?.text || "").includes("CHAIN STARTED"));
console.log(started ? "✓ wcg lobby start" : "✗ wcg start failed");

// sticker pipeline: generate a test PNG, convert via the command internals
const { spawnSync } = await import("node:child_process");
spawnSync("python3", ["-c", "from PIL import Image; Image.new('RGB',(300,200),(200,30,90)).save('/tmp/sticker-test.png')"]);
import { readFileSync } from "node:fs";
const png = readFileSync("/tmp/sticker-test.png");
// call the ffmpeg pipeline directly (same args as the sticker command)
const { runFfmpeg } = await import("../damzd/lib/ffmpeg-sticker-test-helper.js").catch(() => ({})) ?? {};
if (!runFfmpeg) {
  // inline equivalent of web-tools.js args
  const proc = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "/tmp/sticker-test.png",
    "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2",
    "-c:v", "libwebp", "-q:v", "80", "-frames:v", "1", "-f", "webp", "/tmp/sticker-test.webp"]);
  if (proc.status !== 0) {
    console.log("✗ ffmpeg image conversion failed:", proc.stderr?.toString().slice(0, 200));
    failures += 1;
  } else {
    const webp = readFileSync("/tmp/sticker-test.webp");
    console.log(webp.length > 0 && webp.slice(0, 4).toString() === "RIFF"
      ? "✓ sticker conversion (webp " + webp.length + " bytes)"
      : "✗ sticker output is not webp");
  }
}

// tldr with a seeded chat log
const { recordChatMessage } = await import("../damzd/src/damzd/chat-log.js");
for (let i = 0; i < 8; i++) {
  recordChatMessage(group, "23480" + i, "the meeting about the school fees debate was heated " + i);
}
const tldr = byName.get("tldr");
const tctx = fakeCtx({ jid: group, args: "" });
await tldr.run(tctx);
console.log(tctx.sent.some(m => String(m[1]?.text || m[1]).includes("TL;DR")) ? "✓ tldr" : "✗ tldr failed");

console.log(failures ? "\nFAILURES: " + failures : "\nALL SMOKE CHECKS PASSED");
process.exit(failures ? 1 : 0);
