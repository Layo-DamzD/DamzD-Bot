import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { proto } from "@whiskeysockets/baileys";

import {
  createAntiDeleteRuntime,
  createAntiDeleteSettingsStore
} from "../lib/anti-delete.js";

test("anti-delete settings are off by default and are scoped per chat", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-antidelete-"));
  try {
    const settings = createAntiDeleteSettingsStore({
      filePath: path.join(directory, "settings.json")
    });
    const first = "120363000000000001@g.us";
    const second = "120363000000000002@g.us";

    assert.deepEqual(await settings.getSettings(first), {
      enabled: false,
      delivery: "chat"
    });
    await settings.setEnabled(first, true);
    await settings.setDelivery("both");
    assert.deepEqual(await settings.getSettings(first), {
      enabled: true,
      delivery: "both"
    });
    assert.deepEqual(await settings.getSettings(second), {
      enabled: false,
      delivery: "both"
    });
    await settings.flush();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("anti-delete caches enabled text messages and restores on Baileys REVOKE update", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-antidelete-"));
  try {
    const settings = createAntiDeleteSettingsStore({
      filePath: path.join(directory, "settings.json")
    });
    const runtime = createAntiDeleteRuntime({ settings });
    const groupJid = "120363000000000001@g.us";
    const senderJid = "2348000000001@s.whatsapp.net";
    const deletingJid = "2348000000002@s.whatsapp.net";
    const sent = [];

    await settings.setEnabled(groupJid, true);
    const sock = {
      user: { id: "2348000000000@s.whatsapp.net" },
      sendMessage: async (jid, payload) => sent.push({ jid, payload })
    };
    const incoming = {
      key: {
        remoteJid: groupJid,
        participant: senderJid,
        id: "original-message-1",
        fromMe: false
      },
      message: { conversation: "This message was deleted." }
    };

    assert.equal(await runtime.cacheIncomingMessage(sock, incoming), true);
    const handled = await runtime.handleDeleteUpdate(sock, {
      key: {
        remoteJid: groupJid,
        participant: senderJid,
        id: "original-message-1",
        fromMe: false
      },
      update: {
        messageStubType: proto.WebMessageInfo.StubType.REVOKE,
        key: {
          remoteJid: groupJid,
          participant: deletingJid,
          id: "delete-event-1",
          fromMe: false
        }
      }
    });

    assert.equal(handled, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].jid, groupJid);
    assert.match(sent[0].payload.text, /MESSAGE DELETED FOR EVERYONE/);
    assert.deepEqual(sent[0].payload.mentions, [deletingJid, senderJid]);
    assert.equal(sent[1].jid, groupJid);
    assert.equal(sent[1].payload.text, "This message was deleted.");
    assert.equal(runtime.size, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("anti-delete supports DM delivery and does not cache view-once messages", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-antidelete-"));
  try {
    const settings = createAntiDeleteSettingsStore({
      filePath: path.join(directory, "settings.json")
    });
    const runtime = createAntiDeleteRuntime({ settings });
    const groupJid = "120363000000000001@g.us";
    const senderJid = "2348000000001@s.whatsapp.net";
    const sent = [];

    await settings.setEnabled(groupJid, true);
    await settings.setDelivery("dm");
    const sock = {
      user: { id: "2348000000000@s.whatsapp.net" },
      sendMessage: async (jid, payload) => sent.push({ jid, payload })
    };

    const viewOnce = {
      key: { remoteJid: groupJid, participant: senderJid, id: "view-once-1", fromMe: false },
      message: {
        viewOnceMessageV2: {
          message: { imageMessage: { mimetype: "image/jpeg" } }
        }
      }
    };
    assert.equal(await runtime.cacheIncomingMessage(sock, viewOnce), false);
    assert.equal(runtime.size, 0);

    const ordinary = {
      key: { remoteJid: groupJid, participant: senderJid, id: "ordinary-1", fromMe: false },
      message: { conversation: "DM delivery test" }
    };
    assert.equal(await runtime.cacheIncomingMessage(sock, ordinary), true);
    await runtime.handleDeleteUpdate(sock, {
      key: { remoteJid: groupJid, participant: senderJid, id: "ordinary-1", fromMe: false },
      update: {
        messageStubType: proto.WebMessageInfo.StubType.REVOKE,
        key: { remoteJid: groupJid, participant: senderJid, id: "delete-event-2", fromMe: false }
      }
    });

    assert.equal(sent.length, 2);
    assert.equal(sent[0].jid, "2348000000000@s.whatsapp.net");
    assert.equal(sent[1].jid, "2348000000000@s.whatsapp.net");
    assert.equal(sent[1].payload.text, "DM delivery test");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("anti-delete ignores events for disabled chats and unknown cached messages", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-antidelete-"));
  try {
    const settings = createAntiDeleteSettingsStore({
      filePath: path.join(directory, "settings.json")
    });
    const runtime = createAntiDeleteRuntime({ settings });
    const sent = [];
    const sock = {
      user: { id: "2348000000000@s.whatsapp.net" },
      sendMessage: async (jid, payload) => sent.push({ jid, payload })
    };

    const handled = await runtime.handleDeleteUpdate(sock, {
      key: { remoteJid: "120363000000000001@g.us", id: "missing" },
      update: {
        messageStubType: proto.WebMessageInfo.StubType.REVOKE,
        key: { id: "delete-event-3" }
      }
    });
    assert.equal(handled, false);
    assert.equal(sent.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
