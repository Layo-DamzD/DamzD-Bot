import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createGroupModerationStore,
  handleGroupLinkMessage
} from "../lib/group-moderation.js";

test("group moderation settings and warning counts persist independently per group", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-moderation-"));
  const filePath = path.join(directory, "moderation.json");
  try {
    const store = createGroupModerationStore({ filePath });
    const groupA = "120363000000000001@g.us";
    const groupB = "120363000000000002@g.us";
    const member = "2348000000001@s.whatsapp.net";

    assert.deepEqual(await store.getSettings(groupA), { antilink: false, warnlinks: false });
    await store.setSetting(groupA, "antilink", true);
    await store.setSetting(groupA, "warnlinks", true);
    assert.deepEqual(await store.getSettings(groupA), { antilink: true, warnlinks: true });
    assert.deepEqual(await store.getSettings(groupB), { antilink: false, warnlinks: false });

    assert.equal(await store.addWarning(groupA, member), 1);
    assert.equal(await store.addWarning(groupA, member), 2);
    assert.equal(await store.addWarning(groupB, member), 1);
    assert.equal((await store.listWarnings(groupA))[0].count, 2);
    await store.flush();

    const reloaded = createGroupModerationStore({ filePath });
    assert.deepEqual(await reloaded.getSettings(groupA), { antilink: true, warnlinks: true });
    assert.equal((await reloaded.listWarnings(groupA))[0].count, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("opted-in link warnings delete a member link and request removal at warning three", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-link-mod-"));
  const store = createGroupModerationStore({ filePath: path.join(directory, "moderation.json") });
  const groupJid = "120363000000000001@g.us";
  const memberJid = "2348000000001@s.whatsapp.net";
  const deletes = [];
  const notices = [];
  const removals = [];

  try {
    await store.setSetting(groupJid, "warnlinks", true);
    const sock = {
      user: { id: "2348000000000@s.whatsapp.net" },
      groupMetadata: async () => ({
        participants: [
          { id: memberJid, admin: null },
          { id: "2348000000000@s.whatsapp.net", admin: "admin" }
        ]
      }),
      sendMessage: async (jid, payload) => {
        if (payload.delete) deletes.push({ jid, key: payload.delete });
        else notices.push(payload);
      },
      groupParticipantsUpdate: async (jid, users, action) => {
        removals.push({ jid, users, action });
        return [{ jid: users[0], status: "200" }];
      }
    };

    for (let index = 1; index <= 3; index += 1) {
      const handled = await handleGroupLinkMessage({
        sock,
        msg: {
          key: {
            remoteJid: groupJid,
            participant: memberJid,
            id: "link-" + index,
            fromMe: false
          }
        },
        text: "Please visit https://example.com/" + index,
        config: { ownerNumbers: ["2349060715145"] },
        moderation: store
      });
      assert.equal(handled, true);
    }

    assert.equal(deletes.length, 3);
    assert.equal(notices.length, 3);
    assert.match(notices[2].text, /Warning: \*3\/3\*/);
    assert.deepEqual(removals, [{ jid: groupJid, users: [memberJid], action: "remove" }]);
    assert.equal((await store.listWarnings(groupJid))[0].count, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("link moderation ignores messages from admins, the owner and non-group chats", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fei-xmd-link-skip-"));
  const store = createGroupModerationStore({ filePath: path.join(directory, "moderation.json") });
  const groupJid = "120363000000000001@g.us";
  let sends = 0;

  try {
    await store.setSetting(groupJid, "antilink", true);
    const sock = {
      user: { id: "2348000000000@s.whatsapp.net" },
      groupMetadata: async () => ({
        participants: [
          { id: "2348000000001@s.whatsapp.net", admin: "admin" },
          { id: "2348000000000@s.whatsapp.net", admin: "admin" }
        ]
      }),
      sendMessage: async () => { sends += 1; }
    };
    const common = {
      sock,
      text: "https://example.com",
      config: { ownerNumbers: ["2349060715145"] },
      moderation: store
    };

    assert.equal(await handleGroupLinkMessage({
      ...common,
      msg: { key: { remoteJid: groupJid, participant: "2348000000001@s.whatsapp.net", fromMe: false } }
    }), false);
    assert.equal(await handleGroupLinkMessage({
      ...common,
      msg: { key: { remoteJid: groupJid, participant: "2349060715145@s.whatsapp.net", fromMe: false } }
    }), false);
    assert.equal(await handleGroupLinkMessage({
      ...common,
      msg: { key: { remoteJid: "2348000000001@s.whatsapp.net", fromMe: false } }
    }), false);
    assert.equal(sends, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
