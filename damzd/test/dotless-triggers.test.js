import test from "node:test";
import assert from "node:assert/strict";

import { handleDamzDTriggers } from "../src/damzd/triggers.js";
import { loadCommands } from "../handlers/command-loader.js";

// v2.3.0: the dotless set grows from {onlineusers, ghost} to the personal
// words (song, menu, help, lyrics, top) plus EVERY group tool. A bare word
// only fires when the WHOLE message is the command (or the command plus
// args like "song Blinding Lights"); ordinary sentences never trigger.
// The commands keep their own admin/owner checks, so a non-admin typing
// bare "kick" gets the command's own permission error, not a silent run.

async function fire(text, { jid = "2348000000000@s.whatsapp.net" } = {}) {
  const { lookup } = await loadCommands();
  const ran = [];
  await handleDamzDTriggers({
    sock: { user: { id: "2348000000000@s.whatsapp.net" } },
    msg: { key: { remoteJid: jid, id: "t-" + Math.random() }, message: { conversation: text } },
    jid,
    text,
    lookup,
    config: { prefix: "." },
    runParsed: async parsed => ran.push(parsed)
  });
  return ran;
}

test("bare personal words fire without the prefix", async () => {
  for (const word of ["song", "menu", "help", "lyrics", "onlineusers", "ghost", "top"]) {
    const ran = await fire(word);
    assert.equal(ran.length, 1, "'" + word + "' must fire dotless");
    assert.equal(ran[0].commandName, word);
  }
});

test("bare word plus args passes the args through", async () => {
  const ran = await fire("song Blinding Lights");
  assert.equal(ran.length, 1);
  assert.equal(ran[0].commandName, "song");
  assert.equal(ran[0].args, "Blinding Lights");
});

test("every group tool fires dotless", async () => {
  const { lookup } = await loadCommands();
  const groupTools = [...lookup.entries()]
    .filter(([, def]) => def.category === "Group")
    .map(([name]) => name);
  assert.ok(groupTools.length >= 25, "expected the full group toolset, got " + groupTools.length);
  for (const tool of groupTools) {
    const ran = await fire(tool);
    assert.equal(ran.length, 1, "'" + tool + "' must fire dotless");
  }
});

test("ordinary sentences never fire a dotless trigger", async () => {
  for (const sentence of [
    "kick him please",
    "help me with my homework",
    "top of the morning to you",
    "what a menu you have",
    "the ghost story was scary",
    "hello there"
  ]) {
    const ran = await fire(sentence);
    assert.equal(ran.length, 0, JSON.stringify(sentence) + " must not fire");
  }
});

test("bare 'song <title>' intentionally fires — that IS the feature", async () => {
  // A multi-word message starting with 'song'/'lyrics' fires the search.
  // That is the point of dotless song: people type "song Blinding Lights".
  const ran = await fire("song is my favourite thing");
  assert.equal(ran.length, 1);
  assert.equal(ran[0].commandName, "song");
  // The song command itself replies with the honest "song not found"
  // style answer when the query is gibberish — it never crashes the chat.
});

test("non-group, non-personal commands stay prefix-only", async () => {
  for (const word of ["sticker", "ping", "gemini", "grok", "vv", "ggs"]) {
    const ran = await fire(word);
    assert.equal(ran.length, 0, "'" + word + "' must stay prefix-only");
  }
});
