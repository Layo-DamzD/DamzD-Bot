import test from "node:test";
import assert from "node:assert/strict";

import {
  extractApiText,
  unicodeBox,
  withPoweredFooter,
  validateHttpsUrl,
  validateHttpUrl,
  safeFileName
} from "../lib/api-client.js";

test("extracts text from common AI response shapes", () => {
  assert.equal(extractApiText({ response: "hello" }), "hello");
  assert.equal(extractApiText({ data: { answer: "world" } }), "world");
  assert.equal(extractApiText({ result: "done" }), "done");
});

test("formats WhatsApp output and appends the DamzD footer", () => {
  const boxed = unicodeBox("AI RESULT", "A useful answer.", { footer: false });
  assert.ok(boxed.includes("AI RESULT"));
  assert.ok(boxed.includes("A useful answer."));
  assert.ok(withPoweredFooter(boxed).includes("ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢʀᴇᴀᴛ ᴅᴀᴍᴢᴅ"));
});

test("validates HTTPS download URLs and blocks unsafe protocols", () => {
  assert.equal(validateHttpsUrl("https://cdn.example.com/audio.mp3"), "https://cdn.example.com/audio.mp3");
  assert.throws(() => validateHttpsUrl("http://cdn.example.com/audio.mp3"), /unsupported/);
  assert.throws(() => validateHttpsUrl("https://user:pass@cdn.example.com/audio.mp3"), /unsupported/);
});

test("validates public HTTP URLs and rejects local/private addresses", () => {
  assert.equal(validateHttpUrl("https://example.com/video"), "https://example.com/video");
  assert.throws(() => validateHttpUrl("http://127.0.0.1/private"), /public/);
  assert.throws(() => validateHttpUrl("http://localhost/private"), /public/);
});

test("sanitizes download filenames", () => {
  assert.equal(safeFileName("../hello: world?.mp3"), "..hello world.mp3");
});

test("rejects an empty text response", () => {
  assert.throws(() => extractApiText({ data: {} }), /text response/);
});
