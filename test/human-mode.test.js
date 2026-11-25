import test from "node:test";
import assert from "node:assert/strict";

// Keep the human-mode store out of the repo during tests.
process.env.FEI_DATA_DIR = "/tmp/damzd-human-test-" + Date.now();

test("human command registers and refuses non-owners", async () => {
  const { loadCommands } = await import("../handlers/command-loader.js");
  const { lookup } = await loadCommands();
  assert.ok(lookup.get("human"), ".human must be registered");

  const replies = [];
  const ctx = {
    command: "human",
    args: "on",
    owner: false,
    jid: "2348000000000@s.whatsapp.net",
    senderJid: "2348000000000@s.whatsapp.net",
    msg: { key: { remoteJid: "2348000000000@s.whatsapp.net", id: "h-1" }, message: { conversation: ".human on" } },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: ".", ownerNumber: "2348000000000" },
    reply: async value => replies.push(String(value))
  };
  await assert.rejects(() => lookup.get("human").run(ctx), /only the owner/i);
});

test("human mode toggles off by default and flips with the owner command", async () => {
  const { loadCommands } = await import("../handlers/command-loader.js");
  const { isHumanModeEnabled, setHumanMode } = await import("../src/damzd/human.js");
  const { lookup } = await loadCommands();

  assert.equal(await isHumanModeEnabled(), false, "human mode starts off");

  const ctx = args => ({
    command: "human",
    args,
    owner: true,
    jid: "2348000000000@s.whatsapp.net",
    senderJid: "2348000000000@s.whatsapp.net",
    msg: { key: { remoteJid: "2348000000000@s.whatsapp.net", id: "h-2" }, message: { conversation: ".human " + args } },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: ".", ownerNumber: "2348000000000" },
    reply: async () => {}
  });

  await lookup.get("human").run(ctx("on"));
  assert.equal(await isHumanModeEnabled(), true, "owner can switch human mode on");
  await lookup.get("human").run(ctx("off"));
  assert.equal(await isHumanModeEnabled(), false, "owner can switch human mode off");
  // leave the store clean for other suites
  await setHumanMode(false);
});

test("the human gate stays silent for everything that is not plain DM chatter", async () => {
  const { maybeHumanReply } = await import("../src/damzd/human.js");
  const sock = { sendMessage: async () => { throw new Error("must never send"); } };

  // disabled by default
  assert.equal(await maybeHumanReply({ sock, jid: "234111@s.whatsapp.net", text: "hey", msg: { key: { fromMe: false } } }), false);
  // groups and broadcasts never get human replies
  assert.equal(await maybeHumanReply({ sock, jid: "123@g.us", text: "hey", msg: { key: { fromMe: false } } }), false);
  assert.equal(await maybeHumanReply({ sock, jid: "x@broadcast", text: "hey", msg: { key: { fromMe: false } } }), false);
  // the bot never answers itself (loop-proofing)
  assert.equal(await maybeHumanReply({ sock, jid: "234111@s.whatsapp.net", text: "hey", msg: { key: { fromMe: true } } }), false);
  // command-like input is left alone
  assert.equal(await maybeHumanReply({ sock, jid: "234111@s.whatsapp.net", text: ".menu", msg: { key: { fromMe: false } } }), false);
  assert.equal(await maybeHumanReply({ sock, jid: "234111@s.whatsapp.net", text: "!ping", msg: { key: { fromMe: false } } }), false);
  // essays are ignored
  assert.equal(await maybeHumanReply({ sock, jid: "234111@s.whatsapp.net", text: "x".repeat(800), msg: { key: { fromMe: false } } }), false);
  // empty text
  assert.equal(await maybeHumanReply({ sock, jid: "234111@s.whatsapp.net", text: "   ", msg: { key: { fromMe: false } } }), false);
});
