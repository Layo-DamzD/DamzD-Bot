import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadCommands } from "../handlers/command-loader.js";
import {
  createStatusAutomationStore,
  getRandomStatusEmoji,
  processIncomingStatus
} from "../lib/status-automation.js";

test("status automation preferences are disabled by default and persist", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-status-auto-"));
  const filePath = path.join(directory, "settings.json");
  try {
    const store = createStatusAutomationStore({ filePath });
    assert.deepEqual(await store.getSettings(), {
      autoview: false,
      statusreact: false,
      statusreactmode: "random",
      statusreactkeys: []
    });
    await store.setSetting("autoview", true);
    await store.setSetting("statusreact", true);
    await store.setSetting("statusreactmode", ["❤️", "🔥"]);
    await store.setSetting("statusreactkeys", ["hello", "good morning"]);
    await store.flush();

    const restored = createStatusAutomationStore({ filePath });
    assert.deepEqual(await restored.getSettings(), {
      autoview: true,
      statusreact: true,
      statusreactmode: ["❤️", "🔥"],
      statusreactkeys: ["hello", "good morning"]
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("status automation reads only when enabled and reacts once with a rotating emoji pool", async () => {
  const reads = [];
  const reactions = [];
  const sock = {
    user: { id: "2348000000000@s.whatsapp.net" },
    readMessages: async keys => reads.push(...keys),
    sendMessage: async (jid, content, options) => reactions.push({ jid, content, options })
  };
  const settings = {
    autoview: true,
    statusreact: true,
    statusreactmode: ["❤️", "🔥"],
    statusreactkeys: ["hello"]
  };

  const makeMessage = id => ({
    key: {
      remoteJid: "status@broadcast",
      participant: "2348000000001@s.whatsapp.net",
      id,
      fromMe: false
    },
    message: { conversation: "Hello everyone" }
  });

  const first = await processIncomingStatus({ sock, msg: makeMessage("status-auto-1"), settings });
  const duplicate = await processIncomingStatus({ sock, msg: makeMessage("status-auto-1"), settings });
  const second = await processIncomingStatus({ sock, msg: makeMessage("status-auto-2"), settings });

  assert.equal(first.viewed, true);
  assert.equal(first.reacted, true);
  assert.equal(duplicate.reacted, false);
  assert.equal(second.reacted, true);
  assert.equal(reads.length, 3);
  assert.equal(reactions.length, 2);
  assert.deepEqual(reactions.map(item => item.jid), ["status@broadcast", "status@broadcast"]);
  const emojis = reactions.map(item => item.content.react.text);
  assert.ok(emojis.every(emoji => ["❤️", "🔥"].includes(emoji)));
  assert.notEqual(emojis[0], emojis[1], "the reaction pool should avoid immediately repeating an emoji");
  assert.deepEqual(reactions[0].options.statusJidList, [
    "2348000000001@s.whatsapp.net",
    "2348000000000@s.whatsapp.net"
  ]);
});

test("status automation honours the keyword filter and ignores self/non-status events", async () => {
  const reads = [];
  const reactions = [];
  const sock = {
    user: { id: "2348000000000@s.whatsapp.net" },
    readMessages: async keys => reads.push(...keys),
    sendMessage: async (...args) => reactions.push(args)
  };
  const settings = {
    autoview: false,
    statusreact: true,
    statusreactmode: "random",
    statusreactkeys: ["launch"]
  };

  const noMatch = await processIncomingStatus({
    sock,
    msg: {
      key: { remoteJid: "status@broadcast", participant: "2348000000001@s.whatsapp.net", id: "status-no-match", fromMe: false },
      message: { conversation: "Good morning" }
    },
    settings
  });
  const self = await processIncomingStatus({
    sock,
    msg: {
      key: { remoteJid: "status@broadcast", participant: "2348000000000@s.whatsapp.net", id: "status-self", fromMe: true },
      message: { conversation: "Launching today" }
    },
    settings
  });
  const regularChat = await processIncomingStatus({
    sock,
    msg: {
      key: { remoteJid: "2348000000001@s.whatsapp.net", id: "chat-message", fromMe: false },
      message: { conversation: "Launching today" }
    },
    settings
  });

  assert.equal(noMatch.reacted, false);
  assert.equal(self.skipped, true);
  assert.equal(regularChat.skipped, true);
  assert.equal(reads.length, 0);
  assert.equal(reactions.length, 0);
});

test("status automation commands register with the requested aliases", async () => {
  const { lookup } = await loadCommands();
  for (const name of ["autostatus", "autoview", "statusreact", "statusreactmode", "statusreactkeys"]) {
    assert.ok(lookup.has(name), "Missing status automation command " + name);
  }
});

test("the random emoji helper avoids an immediate repeat when alternatives exist", () => {
  assert.equal(getRandomStatusEmoji(["❤️", "🔥"], "❤️"), "🔥");
  assert.equal(getRandomStatusEmoji(["💯"], "💯"), "💯");
});
