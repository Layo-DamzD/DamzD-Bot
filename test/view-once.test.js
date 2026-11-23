import test from "node:test";
import assert from "node:assert/strict";

import { loadCommands } from "../handlers/command-loader.js";
import {
  buildViewOnceCaption,
  viewOncePayload
} from "../commands/custom/vv.js";

test("view-once commands load and register both names", async () => {
  const { lookup } = await loadCommands();
  assert.ok(lookup.get("vv"));
  assert.ok(lookup.get("vv2"));
});

test("view-once recovery returns a useful reply when the command has no quoted message", async () => {
  const { lookup } = await loadCommands();
  const replies = [];
  const ctx = {
    command: "vv",
    args: "",
    jid: "2348000000000@s.whatsapp.net",
    senderJid: "2348000000000@s.whatsapp.net",
    msg: {
      key: { remoteJid: "2348000000000@s.whatsapp.net", id: "command-1" },
      message: { conversation: ".vv" }
    },
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    config: { prefix: "." },
    reply: async value => replies.push(String(value))
  };

  await lookup.get("vv").run(ctx);
  assert.match(replies[0], /Reply to a view-once/i);
});

test("view-once recovery rejects ordinary media that has no view-once wrapper", async () => {
  const { lookup } = await loadCommands();
  const replies = [];
  const ctx = {
    command: "vv",
    args: "",
    jid: "2348000000000@s.whatsapp.net",
    senderJid: "2348000000000@s.whatsapp.net",
    msg: {
      key: { remoteJid: "2348000000000@s.whatsapp.net", id: "command-2" },
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
    config: { prefix: "." },
    reply: async value => replies.push(String(value))
  };

  await lookup.get("vv").run(ctx);
  assert.match(replies[0], /not view-once media/i);
});

test("view-once payload conversion preserves the supported WhatsApp media fields", () => {
  const imageBuffer = Buffer.from("image");
  const image = viewOncePayload({
    kind: "image",
    buffer: imageBuffer,
    media: { caption: "original caption", mimetype: "image/jpeg" }
  });
  assert.equal(image.image, imageBuffer);
  assert.equal(image.caption, "original caption");
  assert.equal(image.mimetype, "image/jpeg");

  const audioBuffer = Buffer.from("audio");
  const audio = viewOncePayload({
    kind: "audio",
    buffer: audioBuffer,
    media: { mimetype: "audio/ogg; codecs=opus", ptt: true }
  });
  assert.equal(audio.audio, audioBuffer);
  assert.equal(audio.mimetype, "audio/ogg; codecs=opus");
  assert.equal(audio.ptt, true);

  const documentBuffer = Buffer.from("document");
  const document = viewOncePayload({
    kind: "document",
    buffer: documentBuffer,
    media: { mimetype: "application/pdf", fileName: "report.pdf" }
  });
  assert.equal(document.document, documentBuffer);
  assert.equal(document.mimetype, "application/pdf");
  assert.equal(document.fileName, "report.pdf");
});

test("view-once recovery caption keeps the supplied original caption and project footer", () => {
  const caption = buildViewOnceCaption({
    media: { caption: "A saved moment" }
  });
  assert.match(caption, /Media extracted from view-once successfully/);
  assert.match(caption, /A saved moment/);
  assert.match(caption, /ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ/);
});
