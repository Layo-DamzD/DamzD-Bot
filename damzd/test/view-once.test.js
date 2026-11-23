import test from "node:test";
import assert from "node:assert/strict";

import { loadCommands } from "../handlers/command-loader.js";

// v2.2.1: .vv/.vv2 are back as TEST extractors (owner's plan: prove the
// view-once engine with them, then .ggs is the everyday tool). All three —
// vv, vv2, ggs — now run the same hardened recovery: every wrapper
// unwrapped (incl. viewOnceMessageV2Extension), direct viewOnce-flagged
// media nodes, view-once voice notes, and the persistent arrival stash
// checked before anything else.

test("vv, vv2, ggs and vvinfo all register", async () => {
  const { lookup } = await loadCommands();
  assert.ok(lookup.get("vv"), ".vv test extractor must be registered");
  assert.ok(lookup.get("vv2"), ".vv2 test extractor must be registered");
  assert.ok(lookup.get("ggs"), ".ggs must be registered");
  assert.ok(lookup.get("gg"), ".gg alias must be registered");
  assert.ok(lookup.get("vvinfo"), ".vvinfo must stay");
});

test("vv with no quoted message explains how to use it", async () => {
  const { lookup } = await loadCommands();
  const replies = [];
  const ctx = {
    command: "vv",
    args: "",
    jid: "2348000000000@s.whatsapp.net",
    senderJid: "2348000000000@s.whatsapp.net",
    msg: {
      key: { remoteJid: "2348000000000@s.whatsapp.net", id: "vv-1" },
      message: { conversation: ".vv" }
    },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: ".", ownerNumber: "2348000000000" },
    reply: async value => replies.push(String(value))
  };

  await lookup.get("vv").run(ctx);
  assert.match(replies[0], /Reply to a view-once/i);
});

test("vv on an ordinary quoted image explains itself and points at ggs and the stash", async () => {
  const { lookup } = await loadCommands();
  const replies = [];
  const ctx = {
    command: "vv",
    args: "",
    jid: "2348000000000@s.whatsapp.net",
    senderJid: "2348000000000@s.whatsapp.net",
    msg: {
      key: { remoteJid: "2348000000000@s.whatsapp.net", id: "vv-2" },
      message: {
        extendedTextMessage: {
          text: ".vv",
          contextInfo: {
            stanzaId: "ordinary-image-1",
            quotedMessage: { imageMessage: { mimetype: "image/jpeg" } }
          }
        }
      }
    },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: ".", ownerNumber: "2348000000000" },
    reply: async value => replies.push(String(value))
  };

  await lookup.get("vv").run(ctx);
  assert.match(replies[0], /not view-once as far as I can tell/i);
  assert.match(replies[0], /\.ggs/i, "the reply must point at .ggs");
  assert.match(replies[0], /\.vvinfo/i, "the reply must point at .vvinfo");
});

test("ggs with no quoted message just answers the good-game line", async () => {
  const { lookup } = await loadCommands();
  const replies = [];
  const ctx = {
    args: "",
    jid: "2348000000000@s.whatsapp.net",
    msg: {
      key: { remoteJid: "2348000000000@s.whatsapp.net", id: "ggs-1" },
      message: { conversation: ".ggs" }
    },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: ".", ownerNumber: "2348000000000" },
    reply: async value => replies.push(String(value))
  };

  await lookup.get("ggs").run(ctx);
  assert.match(replies[0], /GGs/i);
});

test("ggs on an ordinary quoted image answers the good-game line, not an error", async () => {
  const { lookup } = await loadCommands();
  const replies = [];
  const ctx = {
    args: "",
    jid: "2348000000000@s.whatsapp.net",
    msg: {
      key: { remoteJid: "2348000000000@s.whatsapp.net", id: "ggs-2" },
      message: {
        extendedTextMessage: {
          text: ".ggs",
          contextInfo: {
            stanzaId: "ordinary-image-1",
            quotedMessage: { imageMessage: { mimetype: "image/jpeg" } }
          }
        }
      }
    },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: ".", ownerNumber: "2348000000000" },
    reply: async value => replies.push(String(value))
  };

  await lookup.get("ggs").run(ctx);
  assert.match(replies[0], /GGs/i);
  assert.doesNotMatch(replies[0], /view-once/i);
});

test("vvinfo on a never-received message explains the linked-device limitation", async () => {
  const { lookup } = await loadCommands();
  const ctx = {
    args: "",
    jid: "2348000000000@s.whatsapp.net",
    msg: {
      key: { remoteJid: "2348000000000@s.whatsapp.net", id: "vvi-1" },
      message: {
        extendedTextMessage: {
          text: ".vvinfo",
          contextInfo: {
            stanzaId: "never-seen-1",
            quotedMessage: { imageMessage: { mimetype: "image/jpeg" } }
          }
        }
      }
    },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: ".", ownerNumber: "2348000000000" },
    reply: async () => {}
  };

  await assert.rejects(
    lookup.get("vvinfo").run(ctx),
    /never reached me/i,
    "vvinfo must explain that the message never arrived"
  );
});

test("the view-once payload never re-sends as view-once", async () => {
  const { viewOncePayload } = await import("../commands/custom/vv.js");
  const payload = viewOncePayload({
    kind: "image",
    buffer: Buffer.from("bytes"),
    media: { caption: "hello", mimetype: "image/jpeg", viewOnce: true }
  });
  assert.equal(payload.image.toString(), "bytes");
  assert.equal(payload.caption, "hello");
  assert.equal(payload.mimetype, "image/jpeg");
  assert.equal("viewOnce" in payload, false, "viewOnce flag must be stripped");
});
