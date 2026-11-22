import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { sendConnectionCard } from "../src/connection-card.js";

const config = { name: "DamzD", ownerName: "Test owner", prefix: ".", accessMode: "self" };
const commands = [{ name: "song", category: "Downloads", aliases: ["play"] }];
const jid = "123@s.whatsapp.net";

test("cold start sends the bundled photo, preview and live menu in a single self-chat message", async () => {
  const messages = [];
  const sock = { sendMessage: async (to, payload) => messages.push({ to, payload }) };
  const cwd = process.cwd();
  process.chdir(tmpdir());
  try {
    await sendConnectionCard(sock, jid, { ...config, botImage: "assets/bot-image.png" }, commands);
  } finally {
    process.chdir(cwd);
  }
  assert.equal(messages.length, 1);
  const [{ to, payload }] = messages;
  assert.equal(to, jid);
  for (const [key, file] of [["image", "connection-card.jpg"], ["jpegThumbnail", "connection-thumbnail.jpg"]]) {
    assert.deepEqual(payload[key], await readFile(new URL("../assets/" + file, import.meta.url)));
    assert.equal(payload[key].readUInt16BE(0), 0xffd8);
    assert.equal(payload[key].readUInt16BE(payload[key].length - 2), 0xffd9);
  }
  const caption = payload.caption.normalize("NFKC");
  assert.match(caption, /Test owner/);
  assert.match(caption, /COMMANDS LOADED: 2/);
  assert.match(caption, /DOWNLOADS — 1 command/);
});

test("a broken custom image falls back to the bundled photo with the same caption", async () => {
  const attempts = [];
  const sock = { async sendMessage(to, payload) {
    attempts.push(payload);
    if (payload.image.url) throw new Error("unavailable");
  } };
  await sendConnectionCard(sock, jid, { ...config, botImage: "https://example.invalid/image.jpg" }, commands);
  assert.equal(attempts.length, 2);
  assert.ok(Buffer.isBuffer(attempts[1].image));
  assert.equal(attempts[1].caption, attempts[0].caption);
});
