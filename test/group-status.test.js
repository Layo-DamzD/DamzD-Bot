import test from "node:test";
import assert from "node:assert/strict";
import { proto } from "@whiskeysockets/baileys";

import { loadCommands } from "../handlers/command-loader.js";
import {
  GROUP_STATUS_COLORS,
  attachCustomStatusAudience,
  buildGroupStatusRelayMessage,
  parseGroupStatusColor,
  postGroupStatus
} from "../lib/group-status.js";

test("group status commands register independently and keep their aliases", async () => {
  const { lookup } = await loadCommands();
  assert.ok(lookup.get("gcstatus"));
  assert.equal(lookup.get("groupstatus"), lookup.get("gcstatus"));
  assert.ok(lookup.get("gcstatusdm"));
  assert.equal(lookup.get("dmgcstatus"), lookup.get("gcstatusdm"));
  assert.notEqual(lookup.get("gcstatus"), lookup.get("gcstatusdm"));
});

test("group status color parser supports names, custom HEX and random selection", () => {
  assert.deepEqual(parseGroupStatusColor("Hello there!"), {
    text: "Hello there!", color: null, provided: false, error: ""
  });
  assert.equal(parseGroupStatusColor("--color blue Hello").color.hex, "#2563EB");
  assert.equal(parseGroupStatusColor("--color #7c3aed Hello").color.hex, "#7C3AED");
  assert.equal(parseGroupStatusColor("--color random Hello").color, null);
  assert.equal(parseGroupStatusColor("--color nope Hello").error, "Unknown background color: nope");
  assert.equal(GROUP_STATUS_COLORS.length, 11);
});

test("text group statuses carry the V2 envelope and custom Benfei audience metadata", () => {
  const secret = Buffer.alloc(32, 7);
  const inner = proto.Message.fromObject({
    extendedTextMessage: {
      text: "Hello group",
      font: 1,
      backgroundArgb: 0xFF2563EB,
      textArgb: 0xFFFFFFFF,
      contextInfo: { isGroupStatus: true, statusSourceType: 4, statusAudienceMetadata: { audienceType: 1 } }
    }
  });

  const payload = buildGroupStatusRelayMessage("text", inner, secret);
  assert.ok(payload.groupStatusMessageV2);
  assert.equal(payload.groupStatusMessageV2.message.extendedTextMessage.text, "Hello group");
  assert.equal(payload.messageContextInfo.messageSecret.length, 32);
  assert.equal(payload.groupStatusMessageV2.message.messageContextInfo.messageSecret.length, 32);

  attachCustomStatusAudience(payload);
  const audience = payload.groupStatusMessageV2.message.extendedTextMessage.contextInfo.statusAudienceMetadata;
  assert.equal(audience.audienceType, 1);
  assert.equal(audience.listName, "Benfei Tech");
  assert.equal(audience.listEmoji, "🧑‍💻");

  const encoded = proto.Message.encode(payload).finish();
  const nameWire = Buffer.concat([Buffer.from([18, Buffer.byteLength("Benfei Tech")]), Buffer.from("Benfei Tech")]);
  const emojiWire = Buffer.concat([Buffer.from([26, Buffer.byteLength("🧑‍💻")]), Buffer.from("🧑‍💻")]);
  assert.notEqual(encoded.indexOf(nameWire), -1);
  assert.notEqual(encoded.indexOf(emojiWire), -1);
});

test("postGroupStatus relays a text status to the selected group", async () => {
  const calls = [];
  const ctx = {
    sessionId: "test-session",
    sock: {
      user: { id: "2348000000000@s.whatsapp.net" },
      groupMetadata: async jid => ({ id: jid, subject: "Test group" }),
      relayMessage: async (jid, message, options) => calls.push({ jid, message, options })
    }
  };

  const result = await postGroupStatus(ctx, "120363000000000001@g.us", "text", { text: "Hello from FEI" }, GROUP_STATUS_COLORS[1]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].jid, "120363000000000001@g.us");
  assert.equal(calls[0].message.groupStatusMessageV2.message.extendedTextMessage.text, "Hello from FEI");
  assert.equal(calls[0].message.groupStatusMessageV2.message.extendedTextMessage.backgroundArgb, 0xFF2563EB);
  assert.equal(calls[0].message.groupStatusMessageV2.message.extendedTextMessage.contextInfo.statusAudienceMetadata.listName, "Benfei Tech");
  assert.equal(calls[0].options.useCachedGroupMetadata, false);
  assert.equal(calls[0].options.additionalNodes[0].attrs.is_group_status, "true");
  assert.ok(result.messageId);
});

test("view-once replies are rejected by group-status posting", async () => {
  const { lookup } = await loadCommands();
  const replies = [];
  const quotedMessage = {
    viewOnceMessageV2: {
      message: { imageMessage: { mimetype: "image/jpeg", mediaKey: Buffer.alloc(32, 1) } }
    }
  };
  const ctx = {
    owner: true,
    jid: "120363000000000001@g.us",
    args: "",
    msg: {
      key: { id: "command-1", fromMe: false },
      message: {
        extendedTextMessage: {
          text: ".gcstatus",
          contextInfo: { stanzaId: "quoted-1", participant: "2348000000001@s.whatsapp.net", quotedMessage }
        }
      }
    },
    config: { prefix: "." },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    reply: async value => replies.push(String(value))
  };

  await lookup.get("gcstatus").run(ctx);
  assert.match(replies[0], /View-once media is not reposted/);
});
