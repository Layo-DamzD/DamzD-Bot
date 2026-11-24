import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeJid,
  numberFromJid,
  unwrapMessage,
  messageText,
  getMessageSender
} from "../lib/message-utils.js";

test("normalizes WhatsApp JIDs and device suffixes", () => {
  assert.equal(normalizeJid("2348012345678:4@s.whatsapp.net"), "2348012345678@s.whatsapp.net");
  assert.equal(numberFromJid("2348012345678:4@s.whatsapp.net"), "2348012345678");
});

test("unwraps supported message wrappers and extracts text", () => {
  const message = {
    ephemeralMessage: {
      message: {
        extendedTextMessage: { text: "  .ping  " }
      }
    }
  };
  assert.equal(messageText(message), ".ping");
  assert.deepEqual(unwrapMessage(message), {
    extendedTextMessage: { text: "  .ping  " }
  });
});

test("extracts image captions and sender identity", () => {
  assert.equal(messageText({ imageMessage: { caption: ".menu" } }), ".menu");
  assert.equal(
    getMessageSender(
      { key: { remoteJid: "group@g.us", participant: "2348012345678:2@s.whatsapp.net" } },
      {}
    ),
    "2348012345678@s.whatsapp.net"
  );
});
