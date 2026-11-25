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
  const replies = [];
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
    reply: async value => replies.push(String(value))
  };

  // v2.3.3: diagnostics REPLY instead of throwing — the runtime's catch-all
  // used to swallow the throw into a generic "could not be completed".
  await lookup.get("vvinfo").run(ctx);
  assert.ok(replies.length, "vvinfo must reply, not throw");
  assert.match(replies[0], /never reached me/i);
  assert.match(replies[0], /Media remembered since boot/i);
});

test("vvinfo with no quoted message replies a usage hint instead of throwing", async () => {
  const { lookup } = await loadCommands();
  const replies = [];
  const ctx = {
    args: "",
    jid: "2348000000000@s.whatsapp.net",
    msg: {
      key: { remoteJid: "2348000000000@s.whatsapp.net", id: "vvi-2" },
      message: { conversation: ".vvinfo" }
    },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: ".", ownerNumber: "2348000000000" },
    reply: async value => replies.push(String(value))
  };
  await lookup.get("vvinfo").run(ctx);
  assert.ok(replies.length, "vvinfo must reply a usage hint");
  assert.match(replies[0], /reply to the view-once/i);
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

test("recoverBuffer reports what it tried instead of failing flat (v2.4.0)", async () => {
  const { recoverBuffer } = await import("../commands/custom/damzd.js");
  const ctx = {
    jid: "2348000000000@s.whatsapp.net",
    msg: { messageTimestamp: 1800000000 },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } }
  };
  const result = await recoverBuffer(ctx, null, null, null);
  assert.ok(result && !result.buffer, "no source means no buffer");
  assert.match(String(result?.failure || ""), /no source had the bytes/i);
});

test("quote-retry runs the media-retry protocol on a URL-less quote (v2.4.1)", async () => {
  const { refreshQuotedMedia } = await import("../commands/custom/damzd.js");
  const mediaKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
  const node = { mediaKey, mimetype: "image/jpeg", url: "" };
  // The field shape: WhatsApp keeps mediaKey but empties the location.
  const quoted = { viewOnceMessageV2: { message: { imageMessage: node } } };
  const key = {
    remoteJid: "2348000000000@s.whatsapp.net",
    id: "QUOTED-ID",
    fromMe: false,
    participant: "2348111111111@s.whatsapp.net"
  };
  const errors = [];
  const seen = [];
  const ctx = {
    sock: {
      updateMediaMessage: async request => {
        seen.push(request);
        return { message: { imageMessage: { ...node, directPath: "/v/t62.7118-24/fresh", url: "https://mmg.whatsapp.net/v/t62.7118-24/fresh" } } };
      }
    }
  };
  const fresh = await refreshQuotedMedia(ctx, key, quoted, errors);
  assert.ok(fresh?.node?.url, "the refreshed node carries a live URL");
  assert.equal(fresh.kind, "imageMessage");
  assert.equal(seen.length, 1, "exactly one retry request");
  assert.equal(seen[0].key.id, "QUOTED-ID");
  assert.equal(seen[0].key.participant, key.participant, "the sender's jid routes the retry");
  assert.equal(Buffer.isBuffer(seen[0].message.imageMessage.mediaKey), true, "the quoted mediaKey rides along");
  // A refusal is recorded with its reason, not swallowed.
  const ctxRefuse = {
    sock: { updateMediaMessage: async () => { throw new Error("Media re-upload failed by device (MISSING)"); } }
  };
  assert.equal(await refreshQuotedMedia(ctxRefuse, key, quoted, errors), null);
  assert.ok(errors.some(line => /MISSING/.test(line)), "refusal detail reaches the report");
  // A quote without mediaKey cannot be retried at all.
  const noKey = { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } };
  assert.equal(await refreshQuotedMedia(ctx, key, noKey, errors), null);
  assert.ok(errors.some(line => /no mediaKey/.test(line)));
});

test("withheld-content stubs never claim the dedup slot (v2.3.5)", async () => {
  const { isContentWithheldStub } = await import("../lib/whatsapp-runtime.js");
  // The exact shape Baileys upserts when WhatsApp withholds a view-once from
  // this linked device: a CIPHERTEXT stub, "Message absent from node". The
  // re-served copy arrives under the SAME id, so this shape must be flagged
  // — the old code deduped it away and the stash never saw the media.
  assert.equal(isContentWithheldStub({
    messageStubType: "CIPHERTEXT",
    messageStubParameters: ["Message absent from node"]
  }), true, "string stub type must be flagged");
  assert.equal(isContentWithheldStub({
    messageStubType: 9,
    messageStubParameters: ["Message absent from node"]
  }), true, "numeric stub type must be flagged");
  // A key-refresh failure is NOT re-served as a placeholder — it must still
  // be deduped like any other message.
  assert.equal(isContentWithheldStub({
    messageStubType: 9,
    messageStubParameters: ["Key used already or never filled"]
  }), false, "missing-keys stub is not a withheld arrival");
  // Ordinary messages are ordinary.
  assert.equal(isContentWithheldStub({ message: { conversation: "hi" } }), false);
  assert.equal(isContentWithheldStub({}), false);
  assert.equal(isContentWithheldStub(null), false);
});
