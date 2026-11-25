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

test("withheld stubs leave a marker the re-serve overwrites (v2.4.2)", async () => {
  const { stashWithheldStub, stashViewOnce, findCachedViewOnce } =
    await import("../src/damzd/viewonce.js");
  const key = {
    remoteJid: "2348000000000@s.whatsapp.net",
    id: "STUBMARK1",
    fromMe: false,
    participant: "2348111111111@s.whatsapp.net"
  };
  // The stub arrival: only the key is real, the content is withheld.
  assert.equal(stashWithheldStub({ key, messageTimestamp: 1800000000 }), true,
    "the marker is recorded");
  const marker = findCachedViewOnce(key.remoteJid, key.id);
  assert.ok(marker, "a .ggs during the re-serve window finds the marker");
  assert.equal(marker.marker, true, "flagged as a marker, not a real arrival");
  assert.equal(marker.node, null, "no node — the bytes are not here yet");
  assert.equal(marker.kind, "unknown");
  assert.equal(marker.fromMe, false);
  assert.equal(marker.sender, "2348111111111@s.whatsapp.net");
  // Duplicate stubs are absorbed, and a real entry blocks a new marker.
  assert.equal(stashWithheldStub({ key, messageTimestamp: 1800000000 }), false);
  // The re-served copy (same stanza id, full content) replaces the marker.
  const served = {
    key,
    messageTimestamp: 1800000042,
    message: {
      viewOnceMessageV2: {
        message: {
          imageMessage: {
            url: "https://mmg.whatsapp.net/v/t62.7118-24/re-served",
            mimetype: "image/jpeg",
            mediaKey: Buffer.alloc(32, 7)
          }
        }
      }
    }
  };
  assert.equal(stashViewOnce(served), true, "the re-served copy is stashed");
  const fresh = findCachedViewOnce(key.remoteJid, key.id);
  assert.ok(fresh?.node?.url, "the real node replaced the marker");
  assert.equal(fresh.marker, false, "no longer a marker");
  assert.equal(fresh.kind, "image");
  assert.equal(fresh.wasViewOnce, true);
});

test("late recovery auto-delivers when the re-serve lands after .ggs (v2.4.2)", async () => {
  const os = await import("node:os");
  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  const directory = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), "damzd-vvlate-"));
  const { initViewOnceStore, stashWithheldStub, testSeedCapture, findCachedViewOnce } =
    await import("../src/damzd/viewonce.js");
  const { scheduleLateRecovery } = await import("../commands/custom/damzd.js");
  initViewOnceStore(directory);

  const key = {
    remoteJid: "2348000000000@s.whatsapp.net",
    id: "LATEDELIV1",
    fromMe: false,
    participant: "2348111111111@s.whatsapp.net"
  };
  assert.equal(stashWithheldStub({ key, messageTimestamp: 1800000000 }), true);
  assert.ok(findCachedViewOnce(key.remoteJid, key.id).marker, "marker present");

  const ctx = {
    jid: key.remoteJid,
    msg: { messageTimestamp: 1800000100 },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { ownerNumber: "2348000000000" }
  };
  const quotedKey = { remoteJid: key.remoteJid, id: key.id, fromMe: false, participant: key.participant };
  const deliveries = [];
  const deliver = (buffer, node, kind) => deliveries.push({ buffer, node, kind });

  // Armed while WhatsApp still holds the bytes: nothing may be delivered.
  scheduleLateRecovery(ctx, quotedKey, null, deliver, [80, 160]);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(deliveries.length, 0, "no delivery without the bytes");
  // The re-serve landed and the prefetch captured it — seed the same state.
  assert.equal(testSeedCapture(key.remoteJid, key.id, Buffer.from("late-bytes")), true);
  // A re-fired .ggs arms a fresh late check (the first one disarmed itself).
  scheduleLateRecovery(ctx, quotedKey, null, deliver, [80, 160]);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(deliveries.length, 1, "exactly one auto-delivery once the bytes land");
  assert.equal(String(deliveries[0].buffer), "late-bytes");
  assert.equal(deliveries[0].kind, "image", "kind inferred when the marker never learned it");
  // The armed stamp is cleared after delivery — a later .ggs can arm again.
  scheduleLateRecovery(ctx, quotedKey, null, deliver, [40, 80]);
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.equal(deliveries.length, 2, "recovery stays repeatable while the bytes exist");
});
